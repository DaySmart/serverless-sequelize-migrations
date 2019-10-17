const getStage = (serverless, options) => {
  // find the correct stage name
  var stage = serverless.service.provider.stage;
  if (options && options.stage) {
      stage = options.stage;
  }
  return stage;
}

module.exports = {
  getStage
};
