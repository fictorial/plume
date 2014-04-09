#!/usr/bin/env node

var http = require('http')

var _ = require('underscore')
var bcrypt = require('bcrypt-nodejs')
var fs = require('graceful-fs')
var moment = require('moment')
var uuid = require('uuid').v4

var config = {
  port: 8080,
  hostname: '127.0.0.1',
  maxRequestBodySizeBytes: 10 * 1024 * 1024,
  minUsernameLength: 3,
  maxUsernameLength: 32,
  minPasswordLength: 3,
  maxPasswordLength: 128,
  tokenTimeoutMinutes: 15,
  usersPath: __dirname + '/data/users.json'
}

http.ServerResponse.prototype.sendJSON = function (value, code) {
  this.statusCode = code || 200
  var json = JSON.stringify(value || {})
  this.setHeader('Content-Type', 'application/json')
  this.setHeader('Content-Length', Buffer.byteLength(json, 'utf8'))
  this.end(json)
}

http.ServerResponse.prototype.sendError = function (message, code) {
  this.sendJSON({ error: message }, code || 400)
}

function dispatch(request, requestBody, response) {
  console.log(requestBody)

  if (!_.isString(requestBody.rpc))
    return response.sendError('rpc required', 401)

  var rpc = (requestBody.rpc || '').trim().toLowerCase()

  if (!rpc)
    return response.sendError('no rpc specified', 401)

  if (!_.has(rpcs, rpc))
    return response.sendError('rpc unknown', 404)

  var user

  if (!rpc.match(/^signup|login$/)) {
    if (!_.isString(requestBody.token))
      return response.sendError('token required', 401)

    var token = (requestBody.token || '').trim()

    if (!token)
      return response.sendError('token required', 401)

    if (!_.has(tokens, token))
      return response.sendError('token expired or unknown', 401)

    var tokenInfo = tokens[token]
    var user = users[tokenInfo.username]

    if (!user)
      return response.sendError('invalid token: zombie', 401)
  }

  if (_.has(requestBody, 'args') && !_.isObject(requestBody.args))
    return response.sendError('invalid "args" -- object required', 400)

  try {
    rpcs[rpc](requestBody.args || {}, user, response)
  } catch (error) {
    return response.sendError('rpc failed: ' + error, error.code || 500)
  }
}

var users = {}
var tokens = {}

var rpcs = {
  signup: function (args, requestor, response) {
    var username = (args.username || '').trim()
    var password = (args.password || '').trim()

    if (username.length < config.minUsernameLength ||
        username.length > config.maxUsernameLength ||
        password.length < config.minPasswordLength ||
        password.length > config.maxPasswordLength)
      return response.sendError('invalid credentials', 401)

    if (_.findWhere(users, { username:username }))
      return response.sendError('username taken', 409)

    args.password = bcrypt.hashSync(password)

    users[username] = args

    fs.writeFile(config.usersPath, JSON.stringify(users), { encoding: 'utf8' })

    var token = uuid()
    tokens[token] = { username: username, issued: moment() }
    response.sendJSON({ token: token }, 201)
  },

  login: function (args, requestor, response) {
    var username = (args.username || '').trim()
    var password = (args.password || '').trim()

    if (!username || !password)
      return response.sendError('invalid credentials', 401)

    var user = _.findWhere(users, { username:username })

    if (!user)
      return response.sendError('username unknown', 404)

    if (!bcrypt.compareSync(password, user.password))
      return response.sendError('invalid credentials', 401)

    var token = uuid()
    tokens[token] = { username: username, issued: moment() }
    response.sendJSON({ token: token }, 200)
  },
}

setInterval(removeExpiredTokens, 30 * 1000)

function removeExpiredTokens() {
  var removed = 0

  _.each(_.keys(tokens), function (token) {
    var dt = moment().diff(tokens[token].issued, 'minutes')
    if (dt >= config.tokenTimeoutMinutes) {
      delete tokens[token]
      ++removed
    }
  })

  if (removed > 0)
    console.log('[plume-rpc] removed %d expired tokens', removed)
}

exports.addRPC = function (name, callback) {
  var rpcName = (name || '').trim()

  if (!rpcName || rpcName.match(/^login|signup$/i))
    throw new Error('invalid rpc name')

  if (!_.isFunction(callback))
    throw new Error('invalid rpc callback')

  rpcs[rpcName] = callback
}

var server

function createServer() {
  server = http.createServer(function (request, response) {
    request.setEncoding('utf8')

    if (request.method != 'POST')
      response.sendError('POST only', 405)

    var bodyJSON = ''

    request.on('data', function (chunk) {
      bodyJSON += chunk

      if (Buffer.byteLength(bodyJSON) > config.maxRequestBodySizeBytes)
        response.sendError('request too large', 413)
    })

    request.on('end', function () {
      try {
        var requestBody = JSON.parse(bodyJSON)
        dispatch(request, requestBody, response)
      } catch (error) {
        response.sendError(error.message, 400)
      }
    })
  })
}

exports.start = function (configuration) {
  if (server)
    throw new Error('already started')

  if (_.keys(rpcs).length === 2)   // login, signup
    throw new Error('no RPCs added')

  config = _.extend(config, configuration || {})

  loadUsers()

  createServer()

  server.listen(config.port, config.hostname, function () {
    console.log('[plume-rpc] ready http://%s:%d', config.hostname, config.port)
  })
}

function loadUsers() {
  users = {}

  if (fs.existsSync(config.usersPath)) {
    if (!fs.statSync(config.usersPath).isFile())
      throw new Error('expected usersPath to be a file')

    try {
      var contents = fs.readFileSync(config.usersPath, { encoding: 'utf8' })
      users = JSON.parse(contents || '{}')
    } catch (error) {
      console.error('failed to load users file: %s', error)
      throw error
    }
  }
}

exports.stop = function (callback) {
  server.stop(callback)
}

if (!module.parent) {
  console.warn('[plume-rpc] starting echo rpc server')

  exports.addRPC('echo', function (args, user, response) {
    response.sendJSON({ result: args }, 200)
  })

  exports.start()
}
