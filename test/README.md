This library is tested with [Mocha](https://mochajs.org/) and [Chai](http://chaijs.com/) in Nodejs and browsers.
[Karma](https://karma-runner.github.io/) is used to run tests in browsers.

There are 3 main files in this directory:

1. `common.js` - common tests for browsers and Nodejs;
2. `node.js` - Nodejs specific tests;
3. `browser.js` - specific tests for browsers.

To run all tests:

```
npm test
```

This command will execute 4 scripts:

```
npm run lint - test source code with ESLint
npm run build - build dist which we will test
npm run test:node - run node's tests
npm run test:browser - run tests in browsers
```
