var app = app = {functions: {foo: [], bar: []}};
var deployer = require('../../deploy')(app);
deployer.deploy()
  .then(function(data) { console.dir(data); })
  .catch(function(err) { console.dir(err); });
