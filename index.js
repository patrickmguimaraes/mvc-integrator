/*!
 * body-parser
 * Copyright(c) 2021 Patrick Mendes Guimarães
 * MIT Licensed
 */

'use strict'

var fs = require('fs');
var readline = require('readline');

const pathReadLine = readline.createInterface({ input: process.stdin, output: process.stdout });

/**
 * Module exports.
 */

module.exports = mvcIntegrator;

/**
 * Generate TS files with the models created on ERD Editor.
 * @param {String} erdEditorFile - Path from the file where was build the model using ERD Editor
*/
function mvcIntegrator(erdEditorFile) {
  try {
    fs.readFile(erdEditorFile, function (err, data) {
      if (err || !data) { throw new Error("The file '" + erdEditorFile + "' couldn´t be read. " + err ? err : ""); }

      var mvcIntegratorPath = erdEditorFile.replace(".vuerd.json", ".mvc-integrator");

      //Get previous saveOn folders
      if (fs.existsSync(mvcIntegratorPath)) {
        var mvcIntegratorFile = fs.readFileSync(mvcIntegratorPath);
        var mvcIntegrator = JSON.parse(mvcIntegratorFile);

        if (mvcIntegrator.saveOn.length > 0) {
          pathReadLine.question("Would you like to use the previous path(s) folder(s) where were saved the files? \n" + mvcIntegrator.saveOn.toString().replace(",", "\n") + "\n(Y/n): ", (answer) => {
            if (answer.toLowerCase() != 'n') {
              pathReadLine.question("Would you like to add a representative column on the left side of the relationship? (y/N): ", (answer) => {
                createModelFiles(erdEditorFile, mvcIntegrator.saveOn, (answer == 'N' || answer == 'n') ? false : true);
                return;
              });
            }
          });
        }
      }

      makeFirstQuestion(erdEditorFile);
    });
  } catch (error) {
    pathReadLine.close();
    console.log(error);
  }
}

/**
 * Function to be call to ask the user the first question about where to save the model files
 * @param {String} erdEditorFile - Path from the file where was build the model using ERD Editor
 */
function makeFirstQuestion(erdEditorFile) {
  try {
    var defaultPath = erdEditorFile.substring(0, erdEditorFile.lastIndexOf("/") + 1);
    var saveOn = [];

    pathReadLine.question("Type the main folder to generate the models or press enter to (" + defaultPath + "): ", (answer) => {
      if (answer != "") {
        if (!answer.endsWith("/")) { answer = answer + "/"; }
        saveOn.push(answer);
      }
      else { saveOn.push(defaultPath); }

      recursiveInteraction(erdEditorFile, saveOn);
    });
  } catch (error) {
    pathReadLine.close();
    console.log(error);
  }
}

/**
 * Private function ask the user different paths to save the model and also to know if he wants to add a representative column on left side of the relationship.
 * @param {String} erdEditorFile - Path from the file where was build the model using ERD Editor
 * @param {Array<String>} saveOn - Folders paths on the system to save the files
 */
function recursiveInteraction(erdEditorFile, saveOn) {
  try {
    pathReadLine.question("Would you like to add model files in more places? (y/N): ", (answer) => {
      if (answer.toLowerCase() == 'y') {
        pathReadLine.question("Type the new folder to generate the models: ", (answer) => {
          if (answer != "") {
            if (!answer.endsWith("/")) { answer = answer + "/"; }
            saveOn.push(answer);
          }

          recursiveInteraction(erdEditorFile, saveOn);
        });
      }
      else {
        pathReadLine.question("Would you like to add a representative column on the left side of the relationship? (y/N): ", (answer) => {
          createModelFiles(erdEditorFile, saveOn, answer.toLowerCase() != 'y' ? false : true);
        });
      }
    });
  } catch (error) {
    pathReadLine.close();
    console.log(error);
  }
}

/**
 * Generate TS files with the models created on ERD Editor. The system will save the files on the paths sent on the list 'saveOn'.
 * @param {String} erdEditorFile - Path from the file where was build the model using ERD Editor
 * @param {Array<String>} saveOn - Folders paths on the system to save the files
 * @param {Boolean} addColumnFromRightTableOnLeftTable - When is One to One relationship, the system will generate models with the referenced column left table even if this table doens't have an fk from the right table.
 */
function createModelFiles(erdEditorFile, saveOn, addColumnFromRightTableOnLeftTable = true) {
  try {
    //Read the main file (.vuerd.json)
    var mainFile = null;
    if (fs.existsSync(erdEditorFile)) { mainFile = fs.readFileSync(erdEditorFile); }
    if (!mainFile) { console.log("The file '" + erdEditorFile + "' couldn´t be read."); return; }
    var model = JSON.parse(mainFile);

    if (!saveOn || saveOn.length == 0) { console.log("You must to indicate a path to save the model files."); return; }

    //Search for the mvc-integrator file on the same folder as '.vuerd.json' file
    var mvcIntegratorPath = erdEditorFile.replace(".vuerd.json", ".mvc-integrator");
    var mvcIntegrator = { previousFilesSaved: [] };

    if (fs.existsSync(mvcIntegratorPath)) {
      var mvcIntegratorFile = fs.readFileSync(mvcIntegratorPath);
      mvcIntegrator = JSON.parse(mvcIntegratorFile);
    }

    var tableName, columnName, referenceClass, columnValue;
    var tablesMatrix = generateTablesMatrix(model.table.tables);
    var relationshipsMatrix = generateRelationshipMatrix(tablesMatrix, model.relationship.relationships);

    //Fullfil the tableMatrix with more values (columns, colunmsReferencedAndList and allImports)
    model.table.tables.forEach(table => {
      tableName = table.name;

      //Search each column and resolve fks
      table.columns.forEach(column => {
        //Save pks and normal columns
        if (column.ui.fk == false) {
          columnName = column.name;
          referenceClass = getType(column.dataType, column.option.notNull);
          columnValue = column.default != "" ? column.default : getInitialValue(column.dataType);

          tablesMatrix[table.id].columns.push({ name: columnName, type: referenceClass, value: columnValue });
        }
        //Change and save the fks
        else {
          columnName = column.name.substring(2, 3).toLowerCase() + column.name.substring(3);
          referenceClass = relationshipsMatrix[column.id].leftTable;
          columnValue = "new " + relationshipsMatrix[column.id].leftTable + "()";

          //Save imports on the right table (where the fk is)
          tablesMatrix[table.id].allImports.push({ class: referenceClass });

          //Save the column with the properly name and type
          tablesMatrix[table.id].columns.push({ name: columnName, type: referenceClass, value: columnValue });

          switch (relationshipsMatrix[column.id].relationshiptType) {
            case "OneN": {
              //Save imports on the left table
              tablesMatrix[relationshipsMatrix[column.id].leftTableId].allImports.push({ class: tableName });

              //Save a list colunm on the other side table (left) 
              columnName = columnName + tableName + "List"
              referenceClass = "Array<" + tableName + ">";
              columnValue = "new Array<" + tableName + ">()";
              tablesMatrix[relationshipsMatrix[column.id].leftTableId].colunmsReferencedAndList.push({ name: columnName, type: referenceClass, value: columnValue });
              break;
            }
            case "OneOnly": {
              if (addColumnFromRightTableOnLeftTable) {
                //Save imports on the left table
                tablesMatrix[relationshipsMatrix[column.id].leftTableId].allImports.push({ class: tableName });

                //Save a referenced colunm on the other side table (left) 
                columnName = columnName + tableName + "Referenced"
                referenceClass = tableName;
                columnValue = "new " + tableName + "()";
                tablesMatrix[relationshipsMatrix[column.id].leftTableId].colunmsReferencedAndList.push({ name: columnName, type: referenceClass, value: columnValue });
              }
              break;
            }
            default: break;
          }
        }
      });
    });

    console.log("\n");

    if (mvcIntegrator.previousFilesSaved.length > 0) {
      console.log("==> Removing all previous TS files on the path(s): " + saveOn.toString());
      var keepFilesFromOthersFolders = [];

      mvcIntegrator.previousFilesSaved.forEach(previousFileSaved => {
        if (saveOn.includes(previousFileSaved.substring(0, previousFileSaved.lastIndexOf("/") + 1))) {
          if (fs.existsSync(previousFileSaved)) {
            fs.unlinkSync(previousFileSaved, function (err) {
              if (err) { throw err; }
            });
          }
        }
        else {
          keepFilesFromOthersFolders.push(previousFileSaved);
        }
      });

      mvcIntegrator.previousFilesSaved = keepFilesFromOthersFolders;
    }

    saveOn.forEach(saveOnFolder => {
      if (!fs.existsSync(saveOnFolder)) {
        console.log("==> Creating a new dir on " + saveOnFolder);
        fs.mkdirSync(saveOnFolder, { recursive: true }, (err) => {
          if (err) { throw err; }
        });
      }
    });

    console.log("==> Creating new model classes files on '" + saveOn.toString().replace(",", "', '") + "'");

    model.table.tables.forEach(tableERDEditor => {
      var data = "";
      var importData, referencedOrListColumn, dataReferencedOrList = "";
      var importsAlreadyAdd = Array();

      //Add the imports
      tablesMatrix[tableERDEditor.id].allImports.forEach(importItem => {
        importData = "import { " + importItem.class + "} from \"./" + importItem.class + "\";\n";

        //Ignore the repeated imports
        if (importsAlreadyAdd.includes(importItem.class) == false) {
          data = data + importData;
          importsAlreadyAdd.push(importItem.class);
        }
      });

      data = data != "" ? data + "\n" : "";

      //Start the class declaration
      data = data + "export class " + tablesMatrix[tableERDEditor.id].name + " {\n";

      //Add all columns
      tablesMatrix[tableERDEditor.id].columns.forEach(column => {
        data = data + "  " + column.name + ": " + column.type + (column.value != null ? (" = " + column.value) : "") + ";\n";
      });

      //Add lists with tables connected on the left
      dataReferencedOrList = "";
      tablesMatrix[tableERDEditor.id].colunmsReferencedAndList.forEach(column => {
        referencedOrListColumn = "  " + column.name + ": " + column.type + (column.value != null ? (" = " + column.value) : "") + ";\n";

        if (column.name.endsWith("Referenced")) {
          dataReferencedOrList = referencedOrListColumn + dataReferencedOrList;
        }
        else {
          dataReferencedOrList = dataReferencedOrList + referencedOrListColumn;
        }
      });

      data = data + dataReferencedOrList;

      //Finish the class
      data = data + "}";

      saveOn.forEach(saveOnFolder => {

        fs.writeFileSync(saveOnFolder + tablesMatrix[tableERDEditor.id].name + ".ts", data, (err) => {
          if (err) { throw err; }
        });

        if (mvcIntegrator.previousFilesSaved) {
          mvcIntegrator.previousFilesSaved.push(saveOnFolder + tablesMatrix[tableERDEditor.id].name + ".ts");
        }
      });
    });

    //Save the work done on the .mvc-integrator file
    console.log("==> Saving the configuration on " + mvcIntegratorPath);
    mvcIntegrator.saveOn = saveOn;
    fs.writeFileSync(mvcIntegratorPath, JSON.stringify(mvcIntegrator));

    console.log("\nDone!");
    pathReadLine.close();
  } catch (error) {
    pathReadLine.close();
    console.log(error);
  }
}

/**
 * Get the type of a column.
 * @param {String} dataType - Value of the dataType.
 * @param {Boolean} notNull - Value to indicate if the column can be null.
 */
function getType(dataType, notNull) {
  dataType = dataType.toUpperCase();

  switch (dataType) {
    case "BIGINT": { return notNull ? "number" : "Number"; }
    case "SMALLINT": { return notNull ? "number" : "Number"; }
    case "INT": { return notNull ? "number" : "Number"; }
    case "REAL": { return notNull ? "number" : "Number"; }
    case "FLOAT": { return notNull ? "number" : "Number"; }
    case "YEAR": { return notNull ? "number" : "Number"; }
    case "DOUBLE": { return notNull ? "number" : "Number"; }
    case "DOUBLE PRECISION": { return notNull ? "number" : "Number"; }
    case "BIT": { return notNull ? "number" : "Number"; }
    case "DEC": { return notNull ? "number" : "Number"; }
    case "DECIMAL": { return notNull ? "number" : "Number"; }
    case "INTEGER": { return notNull ? "number" : "Number"; }
    case "MEDIUMINT": { return notNull ? "number" : "Number"; }
    case "NUMERIC": { return notNull ? "number" : "Number"; }
    case "TINYINT": { return notNull ? "number" : "Number"; }

    case "VARCHAR": { return notNull ? "string" : "String"; }
    case "TEXT": { return notNull ? "string" : "String"; }
    case "BINARY": { return notNull ? "string" : "String"; }
    case "BLOB": { return notNull ? "string" : "String"; }
    case "CHAR": { return notNull ? "string" : "String"; }
    case "ENUM": { return notNull ? "string" : "String"; }
    case "GEOMETRY": { return notNull ? "string" : "String"; }
    case "GEOMETRYCOLLECTION": { return notNull ? "string" : "String"; }
    case "JSON": { return notNull ? "string" : "String"; }
    case "LINESTRING": { return notNull ? "string" : "String"; }
    case "LONGBLOB": { return notNull ? "string" : "String"; }
    case "POINT": { return notNull ? "string" : "String"; }
    case "POLYGON": { return notNull ? "string" : "String"; }
    case "MULTIPOINT": { return notNull ? "string" : "String"; }
    case "MULTIPOLYGON": { return notNull ? "string" : "String"; }
    case "TIMESTAMP": { return notNull ? "string" : "String"; }
    case "TIME": { return notNull ? "string" : "String"; }
    case "SET": { return notNull ? "string" : "String"; }
    case "TINYBLOB": { return notNull ? "string" : "String"; }
    case "TINYTEXT": { return notNull ? "string" : "String"; }
    case "VARBINARY": { return notNull ? "string" : "String"; }

    case "DATE": { return "Date"; }
    case "DATETIME": { return "Date"; }

    case "BOOLEAN": { return notNull ? "boolean" : "Boolean"; }
    case "BOOL": { return notNull ? "boolean" : "Boolean"; }

    default: break;
  }

  return null;
}

/**
 * Identify if the column needs be initiate and send the properly value.
 * @param {String} dataType - Value of the dataType.
 * @param {Boolean} notNull - Value to indicate if the column can be null.
 */
function getInitialValue(dataType) {

  switch (dataType.toUpperCase()) {
    case "REAL": { return "0.0"; }
    case "DOUBLE": { return "0.0"; }
    case "DOUBLE PRECISION": { return "0.0"; }
    case "DEC": { return "0.0"; }
    case "DECIMAL": { return "0.0"; }
    case "FLOAT": { return "0.0"; }

    case "DATE": { return "new Date()"; }
    case "DATETIME": { return "new Date(new Date().setHours(12, 0, 0, 0))"; }

    default: break;
  }

  return null;
}

/**
 * Generate a matrix with all tables with the key of the table and the name of the class
 * @param {Array} tables 
 */
function generateTablesMatrix(tables) {
  var tablesMatrix = {};

  tables.forEach(table => {
    tablesMatrix[table.id] = { name: table.name, columns: [], colunmsReferencedAndList: [], allImports: [] };
  });

  return tablesMatrix;
}

/**
 * Generate one matrix with all the relationships, returning an id as the key and other information indicating the relationship between one class and another.
 * @param {Array} tables - Array with key (matrix) with all the tables from ERD Editor.
 * @param {Array} relationships - Array with the all the relationships from ERD Editor.
 */
function generateRelationshipMatrix(tablesMatrix, relationships) {
  var relationshipsMatrix = {};

  //The key of the matrix is the fk on the right table
  relationships.forEach(relationship => {
    relationshipsMatrix[relationship.end.columnIds[0]] = { leftTable: tablesMatrix[relationship.start.tableId].name, leftTableId: relationship.start.tableId, rightTable: tablesMatrix[relationship.end.tableId].name, relationshiptType: relationship.relationshipType };
  });

  return relationshipsMatrix;
}
