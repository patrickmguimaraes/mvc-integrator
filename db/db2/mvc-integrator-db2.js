/*!
 * Copyright(c) 2021 Patrick Mendes Guimarães
 * MIT Licensed
 */

'use strict'

var fs = require('fs');
const ibmdb = require('ibm_db');

var exports = {};
var dataBase = ibmdb.Database;

exports.connect = connect;
exports.getDb = getDb;
exports.compareTables = compareTables;

module.exports = exports;

/**
 * Return a promisse with a DB2 dataBase connection based on the parameters 
 * @param {String} DB_DATABASE 
 * @param {String} DB_HOSTNAME 
 * @param {String} DB_PORT 
 * @param {String} DB_UID 
 * @param {String} DB_PWD 
 */
function connect(DB_DATABASE, DB_HOSTNAME, DB_PORT, DB_UID, DB_PWD, callback) {
  var connectionSring = "DATABASE=" + DB_DATABASE + ";HOSTNAME=" + DB_HOSTNAME + ";PORT=" + DB_PORT + ";PROTOCOL=TCPIP;UID=" + DB_UID + ";PWD=" + DB_PWD + ";";

  ibmdb.open(connectionSring, function (err, dataBaseConection) {
    if (err) { callback(null, err); }
    else {
      dataBase = dataBaseConection;
      callback(dataBase, null);
    }
  });
}

/**
 * Function called to get an instance of the database connection made
 */
function getDb() {
  return dataBase;
}

/**
 * Compare the tables in the DB2 system and with the models
 * @param {String} schema - Name of the schema where the tables are
 * @param {String} erdEditorFile - Path where the ERD Editor file were saved
 * @param {String} saveOn - Path where the SQL file shold be saved
 */
function compareTables(schema, erdEditorFile, saveOn=null) {
  //Read the main file (.vuerd.json)
  var mainFile = null;
  if (fs.existsSync(erdEditorFile)) { mainFile = fs.readFileSync(erdEditorFile); }
  if (!mainFile) { console.log("The file '" + erdEditorFile + "' couldn´t be read."); return; }
  
  var model;
  var tableName, columnName, referenceClass, type, notNull, defaultValue, isPk;
  var modelMatrix = {};
  var tablesMatrix = {};
  var relationshipsMatrix = {};

  if (mainFile != null && mainFile != "") {
    model = JSON.parse(mainFile);
    tablesMatrix = generateTablesMatrix(model.table.tables);
    relationshipsMatrix = generateRelationshipMatrix(tablesMatrix, model.relationship.relationships);

    //Fullfil the tableMatrix with more values (columnName, type...)
    model.table.tables.forEach(table => {
      tableName = table.name;
      modelMatrix[tableName] = [];

      table.columns.forEach(column => {
        columnName = column.name;
        type = column.dataType;
        notNull = column.option.notNull;
        defaultValue = column.default;
        isPk = column.option.primaryKey;

        if (column.ui.fk == false) {
          modelMatrix[tableName].push({ name: columnName, type: type, notNull: notNull, defaultValue: defaultValue, isPk: isPk, referenceClass: null });
        }
        else {
          referenceClass = relationshipsMatrix[column.id].leftTable;
          modelMatrix[tableName].push({ name: columnName, type: type, notNull: notNull, defaultValue: defaultValue, isPk: false, referenceClass: referenceClass });
        }
      });
    });
  }

  var query = "SELECT sysCol.TBNAME, sysCol.NAME, sysCol.IDENTITY, sysCol.COLTYPE, sysCol.LENGTH, sysCol.NULLS, sysCol.DEFAULT, ref.CONSTNAME" +
              " FROM SYSIBM.SYSCOLUMNS as sysCol" + 
              " LEFT OUTER JOIN SYSCAT.REFERENCES as ref ON sysCol.NAME=ref.TABNAME" +
              " WHERE sysCol.TBCREATOR = '" + schema + "'" + 
              " ORDER BY sysCol.TBNAME";

  dataBase.query(query,
    function (err, data) {
      if (err) { console.log("Sorry, something wrong happended. " + err); return; }
    
      var tableDb2Matrix = {};
      var key;

      data.forEach(column => {
        key = column.TBNAME;

        if (!tableDb2Matrix[key]) { tableDb2Matrix[key] = [] }

        tableDb2Matrix[key].push(column);
      });

      var sqlCreateTable = "";
      var sqlAlterTableAdd = "";
      var sqlAlterTableRemove = "";
      var sqlAlterTableForeign = "";
      var sqlRemoveTable = "";
      var tableName, pk;
      var exists;
      var columnType;
      var bdColumnType = "";
      var lenght;
      var lastTable = "";

      if (model != null && model.table != null && model.table.tables != null) {
        model.table.tables.forEach(table => {
          tableName = table.name.toUpperCase();
          pk = null;

          if (tableDb2Matrix[tableName] == null) { //Create new tables
            sqlCreateTable = sqlCreateTable + "CREATE TABLE " + schema + "." + table.name + "(\n";

            modelMatrix[table.name].forEach(column => {
              sqlCreateTable = sqlCreateTable + "   " + getColumnSql(column) + ",\n";

              if (column.isPk) { pk = column.name; }

              if (column.referenceClass) {
                sqlAlterTableForeign = sqlAlterTableForeign + getReferenceClass(schema, table.name, modelMatrix, column);
              }
            });

            if (pk != null) { sqlCreateTable = sqlCreateTable + "   PRIMARY KEY(" + pk + ")\n"; }
            sqlCreateTable = sqlCreateTable + ");\n\n";
          }
          else {
            //Search to add new columns
            modelMatrix[table.name].forEach(column => {
              exists = false;

              for (let i = 0; i < tableDb2Matrix[tableName].length; i++) {
                if (column.name.toUpperCase() == tableDb2Matrix[tableName][i].NAME) {
                  exists = true;
                  columnType = getTypeLenght(column.type);
                  bdColumnType = tableDb2Matrix[tableName][i].COLTYPE.trim();
                  lenght = null;

                  if (columnType.endsWith(")")) {
                    lenght = columnType.substring(columnType.indexOf("(") + 1, columnType.indexOf(")"));
                    columnType = columnType.substring(0, columnType.indexOf("("));
                  }

                  if ((columnType != bdColumnType) || (lenght != null && (lenght != tableDb2Matrix[tableName][i].LENGTH))) {
                    sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ALTER COLUMN " + column.name + " SET DATA TYPE " + getTypeLenght(column.type) + ";\n"
                  }

                  if ((column.notNull && tableDb2Matrix[tableName][i].NULLS == 'Y') || (!column.notNull && tableDb2Matrix[tableName][i].NULLS == 'N')) {
                    sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ALTER COLUMN " + column.name + " SET " + (column.notNull ? "NOT NULL" : "NULL") + ";\n"
                  }

                  if ((column.defaultValue == "" && tableDb2Matrix[tableName][i].DEFAULT != null) || (column.defaultValue != "" && tableDb2Matrix[tableName][i].DEFAULT == null) || (column.defaultValue != "" && tableDb2Matrix[tableName][i].DEFAULT != null && column.defaultValue != tableDb2Matrix[tableName][i].DEFAULT)) {
                    sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ALTER COLUMN " + column.name + " SET DEFAULT " + (column.defaultValue == "" ? "null" : column.defaultValue) + ";\n";
                  }

                  break;
                }
              }

              if (!exists) {
                sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ADD COLUMN " + getColumnSql(column) + ";\n";

                if (column.notNull) {
                  sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ALTER COLUMN " + column.name + " SET NOT NULL;\n"
                }

                if (column.defaultValue != "") {
                  sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ALTER COLUMN " + column.name + " SET DEFAULT " + column.defaultValue + ";\n";
                }

                if (column.isPk) {
                  sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " DROP PRIMARY KEY;\n"
                  sqlAlterTableAdd = sqlAlterTableAdd + "ALTER TABLE " + schema + "." + table.name + " ADD PRIMARY KEY (";

                  modelMatrix[table.name].forEach(columnPrimary => {
                    if (columnPrimary.isPk) { sqlAlterTableAdd = sqlAlterTableAdd + columnPrimary.name + ","; }
                  });

                  sqlAlterTableAdd = (sqlAlterTableAdd.endsWith(",") ? sqlAlterTableAdd.substring(0, sqlAlterTableAdd.length - 1) : sqlAlterTableAdd) + ");\n";
                }

                if (column.referenceClass) {
                  sqlAlterTableForeign = sqlAlterTableForeign + getReferenceClass(schema, table.name, modelMatrix, column);
                }
              }
              else if (column.referenceClass && column.CONSTNAME == null) { //If exists the column in both places but haven't add a reference
                sqlAlterTableForeign = sqlAlterTableForeign + getReferenceClass(schema, table.name, modelMatrix, column);
              }
            });

            //Search to remove columns
            tableDb2Matrix[tableName].forEach(dbColumn => {
              exists = false;

              for (var i = 0; i < modelMatrix[table.name].length; i++) {
                if (dbColumn.NAME == modelMatrix[table.name][i].name.toUpperCase()) {
                  exists = true;
                  break;
                }
              }

              if (!exists) {
                sqlAlterTableRemove = "ALTER TABLE " + schema + "." + table.name + " DROP COLUMN " + dbColumn.NAME + ";\n" + sqlAlterTableRemove;
              }
            });
          }
        });
      }

      //Search to remove tables
      data.forEach(column => {
        if (lastTable != column.TBNAME) {
          exists = false;

          if (model != null && model.table != null && model.table.tables != null) {
            for (var i = 0; i < model.table.tables.length; i++) {
              if (model.table.tables[i].name.toUpperCase() == column.TBNAME.toUpperCase()) {
                exists = true;
                break;
              }
            }
          }

          if (!exists) {
            sqlRemoveTable = sqlRemoveTable + "DROP TABLE " + schema + "." + column.TBNAME + ";\n"
          }
        }

        lastTable = column.TBNAME;
      });

      var data = "";
      if (sqlCreateTable != "") {
        data = data + "-------------------------------CREATE TABLE-------------------------------\n" +
          sqlCreateTable +
          "-------------------------------CREATE TABLE-------------------------------\n\n";
      }
      if (sqlAlterTableAdd != "") {
        data = data + "--------------------------------ADD COLUMN--------------------------------\n" +
          sqlAlterTableAdd +
          "--------------------------------ADD COLUMN--------------------------------\n\n";
      }
      if (sqlAlterTableRemove != "") {
        data = data + "-------------------------------DROP COLUMN--------------------------------\n" +
          sqlAlterTableRemove +
          "-------------------------------DROP COLUMN--------------------------------\n\n";
      }
      if (sqlAlterTableForeign != "") {
        data = data + "-------------------------------FOREIGN KEY--------------------------------\n" +
          sqlAlterTableForeign +
          "-------------------------------FOREIGN KEY--------------------------------\n\n";
      }
      if (sqlRemoveTable != "") {
        data = data + "-------------------------------DROP TABLE---------------------------------\n" +
          sqlRemoveTable +
          "-------------------------------DROP TABLE---------------------------------\n\n";
      }

      //if(data!="") { data = data.substring(0, data.lenght-2); }

      if (saveOn != null) {
        if (!saveOn.endsWith("/")) { saveOn = saveOn + "/"; }
        fs.writeFileSync(saveOn + new Date().getTime() + ".sql", data, (err) => {
          if (err) { throw err; }
        });
      }
      else {
        console.log(data);
      }
    });
}

/**
 * Get a SQL column
 * @param {{}} column - Object with the column detail made on ERD Editor
 */
function getColumnSql(column) {
  var sql = column.name + " " + getTypeLenght(column.type);
  if (column.notNull) { sql = sql + " NOT NULL"; }
  if (column.defaultValue != "") { sql = sql + " DEFAULT " + column.defaultValue; }
  if (column.isPk) { sql = sql + " GENERATED BY DEFAULT AS IDENTITY"; }
  return sql;
}

/**
 * Get a SQL for reference
 * @param {String} schema - Name of the schema
 * @param {String} tableName - Name of the table
 * @param {{}} modelMatrix - Matrix made on ERD Editor
 * @param {{}} column - Specific column object taken from the ERD Editor
 */
function getReferenceClass(schema, tableName, modelMatrix, column) {
  var reference = "";
  modelMatrix[column.referenceClass].forEach(referenceClassColumns => {
    if (referenceClassColumns.isPk) {
      reference =  "ALTER TABLE " + schema + "." + tableName + "\n";
      reference = reference + "   FOREIGN KEY (" + column.name + ")\n";
      reference = reference + "       REFERENCES " + column.referenceClass + " (" + referenceClassColumns.name + ")\n";
      reference = reference + "           ON UPDATE RESTRICT\n";
      reference = reference + "           ON DELETE CASCADE;\n\n";
    }
  });

  return reference;
}

/**
 * Passing a datatype, the function returns the data and the lenght in some cases.
 * @param {String} columnType 
 */
function getTypeLenght(columnType) {

  switch (columnType) {
    case "VARCHAR":             { return "VARCHAR(255)"; }
    case "LONGTEXT":            { return "VARCHAR(16320)"; }
    case "TEXT":                { return "VARCHAR(10000)"; }
    case "MEDIUMTEXT":          { return "VARCHAR(5000)"; }
    case "BINARY":              { return "BINARY(255)"; }
    case "BLOB":                { return "BLOB(100000000)"; }
    case "CHAR":                { return "CHARACTER(255)"; }
    case "JSON":                { return "VARCHAR(16320)"; }
    case "LINESTRING":          { return "VARCHAR(255)"; }
    case "LONGBLOB":            { return "BLOB(2147483647)"; }
    case "TIMESTAMP":           { return "VARCHAR(26)"; }
    case "DATETIME":            { return "VARCHAR(26)"; }
    case "TIME":                { return "VARCHAR(8)"; }
    case "SET":                 { return "VARCHAR(255)"; }
    case "TINYBLOB":            { return "BLOB(100000)"; }
    case "TINYTEXT":            { return "VARCHAR(2500)"; }
    case "VARBINARY":           { return "VARBINARY(132704)"; }
    case "GEOMETRY":            { return "GRAPHIC(128)"; }
    case "GEOMETRYCOLLECTION":  { return "VARGRAPHIC(16352)"; }

    case "INT":                 { return "INTEGER"; }
    default: break;
  }

  return columnType;
}

/**
 * Generate a matrix with all tables with the key of the table (the name of the class)
 * @param {Array} tables 
 */
function generateTablesMatrix(tables) {
  var tablesMatrix = {};

  tables.forEach(table => {
    tablesMatrix[table.id] = {name: table.name};
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