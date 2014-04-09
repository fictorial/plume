# Plume - Remote Procedure Call (RPC) server

- HTTP; JSON in, JSON out; POST to /
- Deploy behind ~NGINX (SSL termination, reverse proxying)
- Add your own RPCs
- User management with token-based auth (passwords stored with bcrypt)
  - Issue 'signup' or 'login' RPC to acquire an ephemeral 'token'
  - Pass 'token' to subsequent RPCs
  - If any RPC fails with HTTP status code 401, acquire a new token
    via the 'login' RPC and retry the original RPC

## Signup RPC

    -> { "rpc": "signup",
         "args": { "username": string,
                   "password": string } }

    <- { "token": string }

## Login RPC

    -> { "rpc": "login",
         "args": { "username": string,
                   "password": string } }

    <- { "token": string }

## Any other RPC

    -> { "rpc": string,
         "token": string,
         "args": object }

    <- object

## Errors

    <- { "error": string }

## Environment

Runs anywhere Node.js runs

## Installation

    npm install plume

## Usage

    var plume = require('plume')

    plume.addRPC('echo', function (args, user, response) {
      response.sendJSON({ result: args }, 200)
    })

    plume.addRPC('fail', function (args, user, response) {
      response.sendError('I am an error message', 400)
    })

    plume.start()

## Advanced Usage

    plume.start({
      port: 8080,
      hostname: '127.0.0.1',
      maxRequestBodySizeBytes: 10 * 1024 * 1024,
      minUsernameLength: 3,
      maxUsernameLength: 32,
      minPasswordLength: 3,
      maxPasswordLength: 128,
      tokenTimeoutMinutes: 15,
      usersPath: __dirname + '/data/users.json',
    })

## Author

Brian Hammond <brian@fictorial.com>

## License

MIT
