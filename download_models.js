const path = require('path')
const ACESTEP_DIR = path.join(__dirname, "app", "ACE-Step-1.5");

// Manual model download.
//
// The first `Start` downloads the model inside the engine process, and the
// launcher only moves on when the log line "API endpoints enabled" appears -
// which happens after the download and the model init. On a slow link that
// looks like a hung launcher (and Pinokio may time out the step).
//
// This script does the same download up front, on demand, so the first start
// only has to load the model. It calls the engine's own `acestep-download`
// entry point, which resolves the checkpoints directory from
// ACESTEP_PROJECT_ROOT (or the cwd) - we pin it to app/ACE-Step-1.5 so the
// files land in the very same directory the install links the Pinokio model
// repositories to.
module.exports = {
  run: [
    {
      method: "shell.run",
      params: {
        venv: "env",
        venv_python: "3.11",
        path: "app/ACE-Step-1.5",
        env: {
          ACESTEP_PROJECT_ROOT: ACESTEP_DIR
        },
        message: [
          "acestep-download"
        ]
      }
    }
  ]
}
