/**
 * =======================================================================================
 * Wrapper for Oracle official NodeJS driver {@see https://github.com/oracle/node-oracledb}
 * with autoreconnection feature.
 *
 * Aditional features:
 *     - Auto-connect
 *     - Auto-reconnect if connection lost.
 *     - Using promisies
 * =======================================================================================
 * @author Martin Zaloudek, CZ
 * @module ma-zal/node-oracledb-autoreconnect
 */

/** @type {Q} */
var Q = require('q');
var oracle = require('oracledb');

/** Public API of module */
module.exports.setConnection = setConnection;
module.exports.query = query;
module.exports.connect = connect;
module.exports.disconnect = disconnect;
module.exports.transformToAssociated = transformToAssociated;

/**
 * Current connection to Oracle DB
 * @private
 * @static
 */
var oracleConnection = null;

/**
 * If connection is in progres, holds promise for this connection try
 * @private
 * @type {Defer|null}
 */
var oracleConnectionDefer = null;

/**
 * Manual create connection to Oracle server. If already connected to server, it does NOT connect second one, but use the first one.
 * NOTE: In common use in not necessary to call.
 *
 * @returns {Promise} Oracledb connection object of official Oracledb driver
 */
function connect() {
	if (oracleConnectionDefer === null) {
		// disconnected. Connection is not in progress, so try to connect.
		oracleConnectionDefer = Q.defer();
		oracle.getConnection(oracleConnParams, function (err, connection) {
			if (err) {

				// Connection failed
				console.log("Error DB connecting: ", (err ? (err.message || err) : "no error message"));
				oracleConnection = null;
				oracleConnectionDefer.reject(err && err.message ? err.message : err);
				oracleConnectionDefer = null;
			} else {

				// Connection successfull
				oracleConnection = connection;
				oracleConnectionDefer.resolve(oracleConnection);
			}
		});

	}

	return oracleConnectionDefer.promise;
}

/**
 * Manual disconnect from DB.
 * NOTE: In common use in not necessary to call.
 * @returns {Promise}
 */
function disconnect() {
	var oracleDisconnectionDefer = Q.defer();
	if (oracleConnection !== null) {
		oracleConnection.release(function (err) {
			if (err) {
				oracleDisconnectionDefer.reject(err.message);
				console.error('Oracle disconnect error: ', err.message);
			}
			oracleDisconnectionDefer.resolve();
		});
	}
	oracleConnection = null;
	oracleConnectionDefer = null;

	return oracleDisconnectionDefer.promise;
}

/**
 * Configuration of server connection parameters and credentials for future use in autoconnection/reconnection.
 * Note: Object with parameters is pushed directly into Oracle library into oracledb.getConnection.
 *
 * @param {OracleConnParams} _oracleConnParams
 */
function setConnection(_oracleConnParams) {
	oracleConnParams = _oracleConnParams;
}

/**
 * @type {OracleConnParams}
 * @description Internal store of server connection parameters and credentials.
 * */
var oracleConnParams = null;


/**
 * Makes SQL query with autoconnection and reconnection on error
 * If oracle DB is not connected yet, method will try to connect automatically.
 * If DB is connected, but connection is lost (connection timeout), method will automatically try to reconnect.
 *
 * @param {String} query - SQL query
 * @param {Array} queryParams - Array of values to SQL query
 * @returns {Promise} Result of SQL query
 */
function query(query, queryParams) {

	return connect(oracleConnParams).then(function (oracleConnection) {
		var defer = Q.defer();
		oracleConnection.execute(query, queryParams,
			function (err, dbRes) {
				if (err) {
					// Some error
					console.log("Error executing query: ", err.message);
					if (oracleConnection !== null && err.message && err.message.match(/^ORA-(03114|03135|02396|01012)/)) {
						// 'oracleConnection': If not null, it is first fail of previous connection.
						//     If NULL, connection failed again (this is 3rd try to connect => don't try connect again, return error).
						//
						// Oracle errors:
						//     ORA-03114: not connected to ORACLE
						//     ORA-03135: connection lost contact
						//     ORA-02396: exceeded maximum idle time, please connect again
						//     ORA-01012: not logged on

						// existing connection is not active yet. Change state to disable
						console.info('Oracle connection lost. Trying to reconnect.');

						disconnect.then(function () {
							// Second try to connect and send sql query
							return query(query, queryParams);
						}).then(function (result) {
							defer.resolve(result);
						}).catch(function (err) {
							defer.reject(err && err.message ? err.message : err);
						});

					} else {
						// Unknown error. Close this non-working connection and reject query
						disconnect();
						defer.reject(err);
					}
					return;
				}

				// Result OK
				defer.resolve(dbRes);
			});
		return defer.promise;
	});
}

/**
 * Converts common SQL SELECT result into Array of rows with associated column names.
 * Example:
 *     Input:
 *     {
 *         metaData: [{name:"ID"},{name:"FIRSTNAME"}],
 *         rows: [[1, "JOHN"],[2,"JARYN"]]
 *     }
 *     Converted output:
 *     [
 *         {"ID":1, "FIRSTNAME":"JOHN"}
 *         {"ID":2, "FIRSTNAME":"JARYN"}
 *     ]
 *
 * @param {Object} sqlSelectResult
 * @returns {Array.<Object.<string, *>>}
 */
function transformToAssociated(sqlSelectResult) {
	var assocRows = [];
	var i, l = sqlSelectResult.metaData.length;
	sqlSelectResult.rows.map(function(row) {
		var assocRow = {};
		for (i=0; i<l; i++) {
			assocRow[sqlSelectResult.metaData[i].name] = row[i];
		}
		assocRows.push(assocRow);
	});
	return assocRows;
}

/**
 * @typedef {Object} OracleConnParams
 * @property {String} connectString
 * @property {String} user
 * @property {String} password
 */

/**
 * @name Defer
 * @type {{reject:function, resolve:function, promise:Promise}}
 */
