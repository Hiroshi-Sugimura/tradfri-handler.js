//////////////////////////////////////////////////////////////////////
//	Copyright (C) Hiroshi SUGIMURA 2020.09.19
//////////////////////////////////////////////////////////////////////
'use strict'

const tradfriLib = require("node-tradfri-client");
const TradfriClient = tradfriLib.TradfriClient;
const discoverGateway = tradfriLib.discoverGateway;
const AccessoryTypes = tradfriLib.AccessoryTypes;
const TradfriError = tradfriLib.TradfriError;
const TradfriErrorCodes = tradfriLib.TradfriErrorCodes;

const cron = require('node-cron');


//////////////////////////////////////////////////////////////////////
// Tradfri，複数のTradfri gwを管理する能力はない
// クラス変数
let Tradfri = {
	AccessoryTypes: AccessoryTypes,
	// user config
	securityCode: '', // GWの裏面，初回だけ必要
	identity: '',
	psk: '',
	userFunc: {},  // callback function

	// private
	enabled: false, // 多重起動防止
	gw: {},
	gwAddress: '',
	client: {},
	autoGet: true, // true = 自動的に状態取得をする
	debugMode: false,
	autoGetCron: null,  // 状態の自動取得
	canceled: false,  // 初期化のキャンセル管理

	// public
	facilities: {},	// 全機器情報リスト
	lights: {}, // ライトリスト
	blinds: {}, // ブラインドリスト

	////////////////////////////////////////
	// inner functions

	// 時間つぶす関数
	sleep: async function (ms) {
		return new Promise(function (resolve) {
			setTimeout(function () { resolve() }, ms);
		})
	},


	// キーでソートしてからJSONにする
	// 単純にJSONで比較するとオブジェクトの格納順序の違いだけで比較結果がイコールにならない
	objectSort: function (obj) {
		// まずキーのみをソートする
		let keys = Object.keys(obj).sort();

		// 返却する空のオブジェクトを作る
		let map = {};

		// ソート済みのキー順に返却用のオブジェクトに値を格納する
		keys.forEach(function (key) {
			map[key] = obj[key];
		});

		return map;
	},

	// Object型が空{}かどうかチェックする。 obj == {} ではチェックできない事に注意
	isObjEmpty: function (obj) {
		return Object.keys(obj).length === 0;
	},


	//////////////////////////////////////////////////////////////////////
	// Tradfri特有の手続き
	//////////////////////////////////////////////////////////////////////
	// 何もしない関数, when userFunc is undef, receiving data is forwarded to dummy.
	dummy: function (addr, dev, err) {
		Tradfri.debugMode ? console.log('Tradfri.dummy( addr:', addr, ', dev:', dev, 'err:', err, ')') : 0;
	},

	_deviceUpdated: function (device) {
		// Tradfri.debugMode? console.log('_deviceUpdated, device:', device): 0;

		Tradfri.facilities = Tradfri.client.devices;  // 機器情報更新

		if (Tradfri.userFunc) {
			Tradfri.userFunc(Tradfri.gwAddress, device, null); // アップデートのあったデバイス情報だけ
		}

		if (device.type === AccessoryTypes.lightbulb) {
			Tradfri.lights[device.instanceId] = device;
		} else if (device.type === AccessoryTypes.blind) {
			Tradfri.blinds[device.instanceId] = device;
		}
	},

	_deviceRemoved: function (instanceId) { // clean up
		Tradfri.debugMode ? console.log('_deviceRemoved', instanceId) : 0;
	},

	_observeNotifications: function () {
		Tradfri.debugMode ? console.log('observeNotifications') : 0;
	},


	//////////////////////////////////////////////////////////////////////
	// 初期化
	initialize: async function (securityCode, userFunc, Options = { identity: '', psk: '', autoGet: true, debugMode: false }) {
		// 多重起動防止
		if (Tradfri.enabled) return;
		Tradfri.enabled = true;

		Tradfri.canceled = false; // 初期化キャンセル管理

		Tradfri.gw = {};
		Tradfri.facilities = {};
		Tradfri.securityCode = securityCode == undefined ? '' : securityCode;
		Tradfri.userFunc = userFunc == undefined ? Tradfri.dummy : userFunc;
		Tradfri.debugMode = Options.debugMode == undefined || Options.debugMode == false ? false : true;   // true: show debug log
		Tradfri.autoGet = Options.autoGet != false ? true : false;	// 自動的な状態取得の有無
		Tradfri.identity = Options.identity == undefined || Options.identity === '' ? '' : Options.identity;
		Tradfri.psk = Options.psk == undefined || Options.psk === '' ? '' : Options.psk;

		if (Tradfri.debugMode == true) {
			console.log('==== tradfri-handler.js ====');
			console.log('securityCode:', Tradfri.securityCode, ', identity:', Tradfri.identity, ', psk:', Tradfri.psk);
			console.log('autoGet:', Tradfri.autoGet);
		}

		while (!Object.keys(Tradfri.gw).length) {  // {}でチェックできない
			if (Tradfri.canceled) {  // 初期化中にキャンセルがきた
				Tradfri.userFunc(null, 'Canceled', null);
				Tradfri.enabled = false;
				return null;
			}

			try {
				// find GW
				Tradfri.gw = await discoverGateway();
				if (Tradfri.isObjEmpty(Tradfri.gw)) {
					// 失敗したら30秒まつ
					await Tradfri.sleep(30000);
				}
			} catch (error) {
				console.error('Error: tradfri-handler.initialize().discoverGateway', error);
				Tradfri.enabled = false;
				throw error;
			}
		}

		Tradfri.gwAddress = Tradfri.gw.addresses[0];  // 一つしか管理しない

		Tradfri.debugMode ? console.log('tradfri-handler.initialize() address:', Tradfri.gwAddress, ', gw', Tradfri.gw) : 0;

		Tradfri.client = new TradfriClient(Tradfri.gwAddress);

		if (Tradfri.identity === '') { // 新規Link
			Tradfri.debugMode ? console.log('tradfri-handler.initialize().authenticate, securityCode:', Tradfri.securityCode) : 0;
			try {
				const ret = await Tradfri.client.authenticate(Tradfri.securityCode);
				Tradfri.identity = ret.identity;
				Tradfri.psk = ret.psk;
				Tradfri.debugMode ? console.log('tradfri-handler.initialize() ret identity:', Tradfri.identity) : 0;
				Tradfri.debugMode ? console.log('tradfri-handler.initialize() ret psk:', Tradfri.psk) : 0;
			} catch (error) {
				console.error('Error: tradfri-handler.initialize().authenticate', error);
				console.log('securityCode:', Tradfri.securityCode);
				Tradfri.enabled = false;
				throw error;
			}
		}

		Tradfri.client.on("device updated", Tradfri._deviceUpdated);
		Tradfri.client.on("device removed", Tradfri._deviceRemoved);
		Tradfri.client.on('device notified', Tradfri._observeNotifications);
		try {
			await Tradfri.client.connect(Tradfri.identity, Tradfri.psk);
		} catch (error) {
			switch (error.code) {
				case TradfriErrorCodes.ConnectionTimedOut: {
					// The gateway is unreachable or did not respond in time
					console.error('Error: tradfri-handler.initialize() TradfriErrorCodes.ConnectionTimedOut.');
					console.error('identity:', Tradfri.identity, ', psk:', Tradfri.psk);
				}
				case TradfriErrorCodes.AuthenticationFailed: {
					// The provided credentials are not valid. You need to re-authenticate using `authenticate()`.
					console.error('Error: tradfri-handler.identity() TradfriErrorCodes.AuthenticationFailed.');
					console.error('identity:', Tradfri.identity, ', psk:', Tradfri.psk);
				}
				case TradfriErrorCodes.ConnectionFailed: {
					// An unknown error happened while trying to connect
					console.error('Error: tradfri-handler.identity() TradfriErrorCodes.ConnectionFailed.');
					console.error('identity:', Tradfri.identity, ', psk:', Tradfri.psk);
				}
			}
			throw error;
		}

		if (Tradfri.canceled) {  // 初期化中にキャンセルがきた
			Tradfri.userFunc(null, 'Canceled', null);
			Tradfri.enabled = false;
			return null;
		}

		if (Tradfri.autoGet == true) {
			Tradfri.autoGetStart();
		}
		Tradfri.getState();

		return { identity: Tradfri.identity, psk: Tradfri.psk };
	},

	//====================================================================
	// 初期化キャンセル
	initializeCancel: function () {
		Tradfri.canceled = true;
	},

	//====================================================================
	// 解放
	release: async function () {
		if (!Tradfri.enabled) return; // 多重開放の防止
		Tradfri.enabled = false;
		await Tradfri.autoGetStop();
		await Tradfri.client.destroy();
	},


	//////////////////////////////////////////////////////////////////////
	// request(options, function (error, response, body) { })
	getState: function () {
		// 状態取得
		Tradfri.client.observeDevices();
	},


	setState: async function (devId, devType, command) {
		// const response = await Tradfri.client.request(devId, "post", stateJson);
		Tradfri.debugMode ? console.log('Tradfri.setState() devId:', devId, ', devType:', devType, ', command:', command) : 0;
		switch (devType) {
			case 'light':
				Tradfri.client.operateLight(Tradfri.lights[devId], command);
				break;

			case 'blind':
				Tradfri.client.operateBlind(Tradfri.blinds[devId], command);
				break;

			default:
				Tradfri.debugMode ? console.log('Tradfri.setState() unknown devType:', devType) : 0;
				break;
		}
	},


	//////////////////////////////////////////////////////////////////////
	// 定期的なデバイスの監視
	// インタフェース，監視を始める
	autoGetStart: function () {
		// configファイルにobservationDevsが設定されていれば実施
		Tradfri.debugMode ? console.log('tradfri-handler.autoGetStart()') : 0;

		if (Tradfri.autoGetCron != null) { // すでに開始していたら何もしない
			return;
		}

		if (Tradfri.gwAddress != '') { // IPがすでにないと例外になるので
			Tradfri.autoGetCron = cron.schedule('0 * * * * *', async () => {  // 1分毎にautoget
				Tradfri.getState();
			});

			Tradfri.autoGetCron.start();
		}
	},

	// インタフェース，監視をやめる
	autoGetStop: function () {
		Tradfri.debugMode ? console.log('tradfri-handler.autoGetStop()') : 0;

		if (Tradfri.autoGetCron) { // 現在登録されているタイマーを消す
			Tradfri.autoGetCron.stop();
		}
		Tradfri.autoGetCron = null;
	}
};


module.exports = Tradfri;

//////////////////////////////////////////////////////////////////////
// EOF
//////////////////////////////////////////////////////////////////////
