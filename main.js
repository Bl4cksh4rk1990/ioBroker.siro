/**
 *      ioBroker Siro
 *
 *      Copyright 2019, Bl4cksh4rk <bl4cksh4rk@live.de>
 *
 *      License: MIT
 */
'use strict';
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const request = require('request');
var schedule = require('node-schedule');
const md5 = require('md5');
const uuid = require('./lib/uuid');
let adapter;
const adapterName = require('./package.json').name.split('.').pop();

const ApiURL = 'https://connectoreu.shadeconnector.com:8443';

let objects = {};
let delayed = {};
let connected = null;
let connTimeout;
let hub;
let reconnectTimeout;
let tasks = [];

var AccessToken;
var RefreshToken;
var UserCode;
var ReturnCode;
var SheduleToken;
var ReadInterval;

function startAdapter(options) {
    options = options || {};
    Object.assign(options, {name: adapterName});

    adapter = new utils.Adapter(options);

    adapter.on('ready', function () {
        main();
    });
	
	adapter.on('objectChange', function (id, obj) {
        	if (obj) {
            // The object was changed
            adapter.log.info(`object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            // The object was deleted
            adapter.log.info(`object ${id} deleted`);
        }
    });
	
	adapter.on('stateChange', function (id, state) {
	if (!id || !state || state.ack) {
		return;
	}
	const pos = id.lastIndexOf('.');
	const channelId = id.substring(0, pos);
	const IDkeys = id.split('.');
	const IDState = IDkeys[IDkeys.length - 1];
	var formData;


	adapter.getObject(channelId, (err, obj) => {
		adapter.log.info('Read wirelessMode: ' + obj.native.wirelessMode);

			var TempOperation = null;
			var TempTargetPosition = null;
			if (IDState === "UP") {
				TempOperation = '1';
			} else if (IDState === "DOWN") {
				TempOperation = '0';
			} else if (IDState === "STOP") {
				TempOperation = '2';
			} else if (IDState === "FAV") {
				TempOperation = '12';
			} else if (IDState === "targetPosition") {
				TempTargetPosition = state.val;
			}
			
			if (TempOperation !== null) {
			formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				operation: TempOperation
			};
			} else if (TempTargetPosition !== null) {
				formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				operation: '5'
				};
				request.post({
					url: ApiURL + '/userCenter/deviceService/deviceControl',
					form: formData,
					json: true
				}, function (err, httpResponse, body) {});
				formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				targetPosition: TempTargetPosition
			};
			}

		request.post({
			url: ApiURL + '/userCenter/deviceService/deviceControl',
			form: formData,
			json: true
		}, function (err, httpResponse, body) {
			if (err) {
				return adapter.log.error('Control failed!');
			}
			ReturnCode = body.retCode;
			if (ReturnCode === "20000") {
				adapter.log.info('Control OK');
				adapter.setState(id, {
					val: state.val,
					ack: true
				});
			} else if (ReturnCode === "20108") {
			login();
		} else if (ReturnCode === "20001") {
			adapter.log.info("Server überlastet");
		} else {
				adapter.log.info('Control failed. Return Code: ' + ReturnCode);
				setConnected(false);
			}
		});
	});
    });

    return adapter;
}

function disconnected() {
	connTimeout = null;
	if (connected) {
		connected = false;
		adapter.log.info(`Change connection status on timeout after ${adapter.config.heartbeatTimeout}ms: false`);
		adapter.setState('info.connection', connected, true);
	}

	stopConnector();
}

function stopConnector() {
	if (!reconnectTimeout) {
		reconnectTimeout = setTimeout(main, adapter.config.restartInterval);
	}
}

function setConnected(conn) {
	if (connected !== conn) {
		connected = conn;
		adapter.log.info('Change connection status: ' + conn);
		adapter.setState('info.connection', connected, true);
	}

	if (conn && adapter.config.heartbeatTimeout) {
		if (connTimeout) {
			clearTimeout(connTimeout);
		}

		connTimeout = setTimeout(disconnected, adapter.config.heartbeatTimeout);
	}
}

function setStates(id, val) {
	adapter.setState(id, {
						val: val,
						ack: true
					});
	return '';
}

function ReadDevicesFromServer() {
	request.post({
		url: ApiURL + '/userCenter/areaService/getAreasWithDevices',
		form: {
			accessToken: AccessToken,
			msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase()
		},
		json: true
	}, function (err, httpResponse, body) {
		if (err) {
			setConnected(false);
			return adapter.log.error('Read Devices failed!');
		}
		if (!('areas' in body)) {
			return adapter.log.info('Read Devices failed!');
		}

		ReturnCode = body.retCode;
		if (ReturnCode === "20000") {
			setConnected(true);
			adapter.log.debug('Read Devices...');
			for (var key in body.areas[0].childAreas[0].childAreas) {
				var obj = body.areas[0].childAreas[0].childAreas[key];
				adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_'), {
					type: 'device',
					common: {
						name: obj.areaName,
						role: 'room',
						type: 'object'
					},
					native: {}
				});

				for (var key2 in obj.devices) {
					var device = obj.devices[key2];
					var deviceData = JSON.parse(device.deviceData);

					adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_'), {
						type: 'channel',
						common: {
							name: device.deviceAlias,
							role: 'blind',
							type: 'object'
						},
						native: {
							mac: device.mac,
							deviceType: device.deviceType,
							wirelessMode: deviceData.wirelessMode
						}
					});

					adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.RSSI', {
						type: 'state',
						common: {
							name: 'RSSI',
							role: 'value.rssi',
							write: false,
							read: true,
							type: 'number'
						},
						native: {}
					});
					setStates(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.RSSI', deviceData.RSSI);

					adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.operation', {
						type: 'state',
						common: {
							name: 'operation',
							role: 'state',
							states: {"0": "Runter fahren",
									 "1": "Hoch fahren",
									 "2": "Stop",
									 "3": "Fahrtrichtung ändern",
									 "4": "Limit Set",
									 "5": "Status",
									 "6": "Batterie",
									 "7": "Schritt hoch",
									 "8": "Schritt runter",
									 "9": "Endlage oben speichern",
									 "10": "Endlage unten speichern",
									 "11": "Favoritenposition speichern",
									 "12": "Favoritenposition anfahren",
									 "13": "Endlage oben einstellen",
									 "14": "Endlage unten einstellen"},
							write: false,
							read: true,
							type: 'number'
						},
						native: {}
					});
					setStates(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.operation', deviceData.operation);

						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.UP', {
							type: 'state',
							common: {
								name: 'UP',
								role: 'button',
								write: true,
								read: false,
								type: 'boolean'
							},
							native: {}
						});

						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.DOWN', {
							type: 'state',
							common: {
								name: 'DOWN',
								role: 'button',
								write: true,
								read: false,
								type: 'boolean'
							},
							native: {}
						});
					
						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.FAV', {
							type: 'state',
							common: {
								name: 'FAV',
								role: 'button',
								write: true,
								read: false,
								type: 'boolean'
							},
							native: {}
						});

						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.STOP', {
							type: 'state',
							common: {
								name: 'STOP',
								role: 'button.stop',
								write: true,
								read: false,
								type: 'boolean'
							},
							native: {}
						});
					if (deviceData.wirelessMode === 1) { //1 = Bi-Direktional Punktanfahrung
						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.batteryLevel', {
							type: 'state',
							common: {
								name: 'batteryLevel',
								unit: '%',
								role: 'value.battery',
								write: false,
								read: true,
								type: 'number'
							},
							native: {}
						});
						setStates(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.batteryLevel', Math.round(deviceData.batteryLevel / 10));

						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.currentState', {
							type: 'state',
							common: {
								name: 'currentState',
								role: 'state',
								write: false,
								read: true,
								type: 'number'
							},
							native: {}
						});
						setStates(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.currentState', deviceData.currentState);
						
						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.currentPosition', {
							type: 'state',
							common: {
								name: 'currentPosition',
								unit: '%',
								role: 'value.blind',
								write: false,
								read: true,
								type: 'number'
							},
							native: {}
						});
						setStates(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.currentPosition', deviceData.currentPosition);
						
						adapter.setObjectNotExists(obj.areaName.replace(/ /g, '_') + '.' + device.deviceAlias.replace(/ /g, '_') + '.targetPosition', {
							type: 'state',
							common: {
								name: 'targetPosition',
								unit: '%',
								role: 'level.blind',
								write: true,
								read: true,
								type: 'number'
							},
							native: {}
						});
					}
				}
			}

		} else if (ReturnCode === "20108") {
			adapter.log.error('Not Authorized. Login again after Returncode: ' + ReturnCode);
			login();
		} else if (ReturnCode === "20001") {
			adapter.log.info("Server überlastet");
		}
		else {
			setConnected(false);

		}
	});
}

function refreshToken() {
	if (connected !== true) {
	adapter.log.info('Token failed. Not Logged in');
	return;
	}
	
   adapter.log.info('refresh Token...');

   request.post({
		url: ApiURL + '/userCenter/user/refreshToken',
		form: {
			accessToken: AccessToken,
			refreshToken: RefreshToken,
			msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase()
		},
		json: true
	}, function (err, httpResponse, body) {
		if (err) {
			setConnected(false);
			return adapter.log.error('HTTP Request Error: Refresh Token failed!');
		}
		ReturnCode = body.retCode;
		if (ReturnCode === "20000") {
			setConnected(true);
			AccessToken = body.accessToken;
			RefreshToken = body.refreshToken;
			UserCode = body.userCode;
			adapter.log.info('Token refreshed.');
		} else if (ReturnCode === "20108") {
			adapter.log.error('Not Authorized. Login again after Returncode: ' + ReturnCode);
			login();
		} else {
			adapter.log.error('Token refresh failed! Returncode: ' + ReturnCode);
			setConnected(false);
		}
	});
}

function login() {
	request.post({
		url: ApiURL + '/userCenter/user/login',
		form: {
			loginName: adapter.config.user,
			password: md5(adapter.config.pw).toUpperCase(),
			appCode: '92c9c09a-b7b5-4c6c-bbb9-028b761763d9',
			msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase()
		},
		json: true
	}, function (err, httpResponse, body) {
		if (err) {
			setConnected(false);
			return adapter.log.error('HTTP Request Error: Login failed!');
		}
		ReturnCode = body.retCode;
		if (ReturnCode === "20000") {
			setConnected(true);
			AccessToken = body.accessToken;
			RefreshToken = body.refreshToken;
			UserCode = body.userCode;
			adapter.log.info('Logged in with Access Token: ' + AccessToken.substr(0, AccessToken.length-3)+'***');
		} else {
			setConnected(false);
			adapter.log.info('Login failed. Return Code: ' + ReturnCode);
		}
	});
}

function main() {
	reconnectTimeout = null;

	adapter.subscribeStates('*');

	if (!adapter.config.user || !adapter.config.pw) return;

	login();
	
	//var j = schedule.scheduleJob("*/1 * * * *", function(){
	if (!SheduleToken) {
	SheduleToken = schedule.scheduleJob("0 */12 * * *", function(){ //Tokenrefresh alle 12 Stunden
	refreshToken();
	});
	adapter.log.info('Token refresh Shedule added!');
	}
	
	ReadInterval = setInterval(function () {
	// alle 10 Sekunden ausführen 
	if (connected) {
	ReadDevicesFromServer();
	}
	}, 10000);
}

if (module && module.parent) {
    module.exports = startAdapter;
} else {
    // or start the instance directly
    startAdapter();
}
