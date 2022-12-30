# docker_child_process

Simple docker agent to NodeJS to run scripts in a container.

## Installation

Using [npm](https://npmjs.com):

```sh
$ npm install docker_child_process
```

In NodeJS:

```ts
import { createInterface } from "docker_child_process";

const dockerInstance = createInterface();

await dockerInstance.init();

await dockerInstance.exec(`echo ok`);
// ## Docker: ok

const { outputs } = await dockerInstance.exec(`echo "###=> FOO=VAZ"`);

outputs; // => { FOO: "VAZ" }

const { outputs } = await dockerInstance.exec(
    `echo '###=> FOO={ "VAZ": "BIZ" }'`
);

outputs; // => { FOO: { VAZ: "BIZ" } }

const { outputs } = await dockerInstance.exec(
    `echo "### => lodash=$(npm search lodash --json -p | jq '.[0]' -r --indent 0)"`
);

outputs; // => { lodash:{"name":"lodash","scope":"unscoped","version":"4.17.21","description":"Lodash modular utilities.","keywords":["modules","stdlib","util"],"date":"2021-02-20T15:42:16.891Z","links":{"npm":"https://www.npmjs.com/package/lodash","homepage":"https://lodash.com/","repository":"https://github.com/lodash/lodash","bugs":"https://github.com/lodash/lodash/issues"},"author":{"name":"John-David Dalton","email":"john.david.dalton@gmail.com","username":"jdalton"},"publisher":{"username":"bnjmnt4n","email":"benjamin@dev.ofcr.se"},"maintainers":[{"username":"mathias","email":"mathias@qiwi.be"},{"username":"jdalton","email":"john.david.dalton@gmail.com"},{"username":"bnjmnt4n","email":"benjamin@dev.ofcr.se"}]} }
```
