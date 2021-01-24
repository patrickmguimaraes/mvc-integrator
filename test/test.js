var mvcIntegrator = require('../index.js');

//This call will generate model files from the ERD model test made on "/test/model.vuerd.json
mvcIntegrator(__dirname + '/model.vuerd.json');