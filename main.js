/**
 *      ioBroker Connector
 *
 *      Copyright 2019, Bl4cksh4rk <bl4cksh4rk@live.de>
 *
 *      License: MIT
 */
'use strict';
const utils = require('@iobroker/adapter-core'); // Get common adapter utils
const adapter = utils.Adapter('connector');
const request = require('request');
const md5 = require('md5');
const uuid = require('./lib/uuid');

let objects = {};
let delayed = {};
let connected = null;
let connTimeout;
let hub;
let reconnectTimeout;
let tasks = [];

let AccessToken;
let ReturnCode;


adapter.on('ready', main);

adapter.on('stateChange', (id, state) => {
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

		if (obj.native.wirelessMode === 0) { //One Way no Point
			var TempOperation;
			if (IDState === "UP") {
				TempOperation = '1';
			} else if (IDState === "DOWN") {
				TempOperation = '0';
			} else if (IDState === "STOP") {
				TempOperation = '2';
			}
			formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				operation: TempOperation
			};
		} else if (obj.native.wirelessMode === 1) { //Two Way Point
			formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				targetPosition: state.val
			};
		} else if (obj.native.wirelessMode === 2) { //Two Way no Point
			formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				targetPosition: state.val
			};
		} else if (obj.native.wirelessMode === 3) { //OneWay Point
			formData = {
				accessToken: AccessToken,
				msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase(),
				mac: obj.native.mac,
				deviceType: obj.native.deviceType,
				targetPosition: state.val
			};
		}

		request.post({
			url: 'https://connectoreu.shadeconnector.com:8443/userCenter/deviceService/deviceControl',
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
			} else {
				adapter.log.info('Control failed. Return Code: ' + ReturnCode);
			}
		});
	});
});

var ReadInterval = setInterval(function () {
	// alle 3 Sekunden ausführen 
	ReadDevicesFromServer();
}, 10000);

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
	clearInterval(ReadInterval);
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

function ReadDevicesFromServer() {
	request.post({
		url: 'https://connectoreu.shadeconnector.com:8443/userCenter/areaService/getAreasWithDevices',
		form: {
			accessToken: AccessToken,
			msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase()
		},
		json: true
	}, function (err, httpResponse, body) {
		if (err) {
			return adapter.log.error('Read Devices failed!');
		}
		ReturnCode = body.retCode;
		if (ReturnCode === "20000") {
			setConnected(true);
			adapter.log.info('Read Devices...');
			for (var key in body.areas[0].childAreas[0].childAreas) {
				var obj = body.areas[0].childAreas[0].childAreas[key];
				adapter.setObjectNotExists(obj.areaName, {
					type: 'device',
					common: {
						name: obj.areaName,
						role: 'room'
					},
					native: {}
				});

				for (var key2 in obj.devices) {
					var device = obj.devices[key2];
					var deviceData = JSON.parse(device.deviceData);

					adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias, {
						type: 'channel',
						common: {
							name: device.deviceAlias,
							role: 'blind'
						},
						native: {
							mac: device.mac,
							deviceType: device.deviceType,
							wirelessMode: deviceData.wirelessMode
						}
					});

					adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.RSSI', {
						type: 'state',
						common: {
							name: 'RSSI',
							role: 'value',
							write: false,
							read: true
						},
						native: {}
					});
					adapter.setState(obj.areaName + '.' + device.deviceAlias + '.RSSI', {
						val: deviceData.RSSI,
						ack: true
					});

					adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.operation', {
						type: 'state',
						common: {
							name: 'operation',
							role: 'value',
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
							read: true
						},
						native: {}
					});
					adapter.setState(obj.areaName + '.' + device.deviceAlias + '.operation', {
						val: deviceData.operation,
						ack: true
					});

					if (deviceData.wirelessMode === 0) {
						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.UP', {
							type: 'state',
							common: {
								name: 'UP',
								role: 'button',
								write: true,
								read: false
							},
							native: {}
						});

						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.DOWN', {
							type: 'state',
							common: {
								name: 'DOWN',
								role: 'button',
								write: true,
								read: false
							},
							native: {}
						});

						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.STOP', {
							type: 'state',
							common: {
								name: 'STOP',
								role: 'button.stop',
								write: true,
								read: false
							},
							native: {}
						});
					} else if (deviceData.wirelessMode === 1) { //1 = Bi-Direktional Punktanfahrung
						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.batteryLevel', {
							type: 'state',
							common: {
								name: 'batteryLevel',
								unit: '%',
								role: 'value.battery',
								write: false,
								read: true
							},
							native: {}
						});
						adapter.setState(obj.areaName + '.' + device.deviceAlias + '.batteryLevel', {
							val: Math.round(deviceData.batteryLevel / 10),
							ack: true
						});

						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.currentState', {
							type: 'state',
							common: {
								name: 'currentState',
								role: 'value',
								write: false,
								read: true
							},
							native: {}
						});
						adapter.setState(obj.areaName + '.' + device.deviceAlias + '.currentState', {
							val: deviceData.currentState,
							ack: true
						});
						
						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.currentPosition', {
							type: 'state',
							common: {
								name: 'currentPosition',
								unit: '%',
								role: 'value.blind',
								write: false,
								read: true
							},
							native: {}
						});
						adapter.setState(obj.areaName + '.' + device.deviceAlias + '.currentPosition', {
							val: deviceData.currentPosition,
							ack: true
						});

						adapter.setObjectNotExists(obj.areaName + '.' + device.deviceAlias + '.targetPosition', {
							type: 'state',
							common: {
								name: 'targetPosition',
								unit: '%',
								role: 'level.blind',
								write: true,
								read: true
							},
							native: {}
						});
					}
				}
			}
		} else {
			setConnected(false);

		}
	});
}

function main() {
	reconnectTimeout = null;

	adapter.subscribeStates('*');

	if (!adapter.config.user || !adapter.config.pw) return;

	request.post({
		url: 'https://connectoreu.shadeconnector.com:8443/userCenter/user/login',
		form: {
			loginName: adapter.config.user,
			password: md5(adapter.config.pw).toUpperCase(),
			appCode: '92c9c09a-b7b5-4c6c-bbb9-028b761763d9',
			msgId: uuid.generateUUID().replace(/-/g, '').toUpperCase()
		},
		json: true
	}, function (err, httpResponse, body) {
		if (err) {
			return adapter.log.error('Login failed!');
		}
		ReturnCode = body.retCode;
		if (ReturnCode === "20000") {
			setConnected(true);
			AccessToken = body.accessToken;
			adapter.log.info('Logged in with Access Token: ' + AccessToken);
		} else {
			adapter.log.info('Login failed. Return Code: ' + ReturnCode);
		}
	});
}
