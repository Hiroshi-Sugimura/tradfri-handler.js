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
/**
 * Tradfri管理オブジェクト
 * 注意: 複数のTradfriゲートウェイを管理する機能はありません。
 * @namespace Tradfri
 */
let Tradfri = {
	/** @type {AccessoryTypes} AccessoryTypesへの参照 */
	AccessoryTypes: AccessoryTypes,

	// user config
	/** @type {string} ゲートウェイ裏面のセキュリティコード (初回認証時のみ必要) */
	securityCode: '',
	/** @type {string} 接続用 Identity */
	identity: '',
	/** @type {string} 接続用 Pre-shared key */
	psk: '',
	/** @type {Object|function} コールバック関数 */
	userFunc: {},

	// private
	/** @type {boolean} 多重起動防止フラグ */
	enabled: false,
	/** @type {Object} ゲートウェイ情報 */
	gw: {},
	/** @type {string} ゲートウェイIPアドレス */
	gwAddress: '',
	/** @type {Object} TradfriClient インスタンス */
	client: {},
	/** @type {boolean} 自動状態取得フラグ (true = 自動) */
	autoGet: true,
	/** @type {boolean} デバッグモードフラグ */
	debugMode: false,
	/** @type {Object|null} 自動取得用cronジョブ (永続監視のため現在は未使用) */
	autoGetCron: null,
	/** @type {boolean} 初期化キャンセル管理フラグ */
	canceled: false,

	// public
	/** @type {Object} 全機器情報リスト */
	facilities: {},
	/** @type {Object} ライトリスト */
	lights: {},
	/** @type {Object} ブラインドリスト */
	blinds: {},

	////////////////////////////////////////
	// inner functions

	/**
	 * 指定時間スリープする
	 * @param {number} ms - スリープする時間(ミリ秒)
	 * @returns {Promise<void>}
	 */
	sleep: async function (ms) {
		return new Promise(function (resolve) {
			setTimeout(function () { resolve() }, ms);
		})
	},

	/**
	 * オブジェクトが空かどうか判定する
	 * 注意: `obj == {}` では判定できません
	 * @param {Object} obj - 判定対象のオブジェクト
	 * @returns {boolean} 空の場合はtrue、それ以外はfalse
	 */
	isObjEmpty: function (obj) {
		return Object.keys(obj).length === 0;
	},


	//////////////////////////////////////////////////////////////////////
	// Tradfri特有の手続き
	//////////////////////////////////////////////////////////////////////
	/**
	 * userFuncが未定義の場合のダミー関数
	 * @param {string} addr - アドレス (未使用)
	 * @param {Object} dev - デバイスオブジェクト (未使用)
	 * @param {Object} err - エラーオブジェクト (未使用)
	 */
	dummy: function (addr, dev, err) {
		Tradfri.debugMode ? console.log('Tradfri.dummy( addr:', addr, ', dev:', dev, 'err:', err, ')') : 0;
	},

	/**
	 * デバイス更新時のコールバック
	 * @param {Object} device - 更新されたデバイスオブジェクト
	 */
	_deviceUpdated: function (device) {
		// Tradfri.debugMode? console.log('_deviceUpdated, device:', device): 0;

		Tradfri.facilities = Tradfri.client.devices;  // 機器情報更新

		if (Tradfri.userFunc) {
			Tradfri.userFunc(Tradfri.gwAddress, device, null); // アップデートのあったデバイス情報だけ通知
		}

		if (device.type === AccessoryTypes.lightbulb) {
			Tradfri.lights[device.instanceId] = device;
		} else if (device.type === AccessoryTypes.blind) {
			Tradfri.blinds[device.instanceId] = device;
		}
	},

	/**
	 * デバイス削除時のコールバック
	 * 内部リストから削除を行います
	 * @param {number} instanceId - 削除されたデバイスのID
	 */
	_deviceRemoved: function (instanceId) {
		Tradfri.debugMode ? console.log('_deviceRemoved', instanceId) : 0;
		if (Tradfri.facilities[instanceId]) delete Tradfri.facilities[instanceId];
		if (Tradfri.lights[instanceId]) delete Tradfri.lights[instanceId];
		if (Tradfri.blinds[instanceId]) delete Tradfri.blinds[instanceId];
	},

	/**
	 * 通知監視用コールバック
	 */
	_observeNotifications: function () {
		Tradfri.debugMode ? console.log('observeNotifications') : 0;
	},


	//////////////////////////////////////////////////////////////////////
	// 初期化
	/**
	 * Tradfriハンドラの初期化
	 * @param {string} securityCode - セキュリティコード
	 * @param {function} userFunc - ユーザーコールバック関数
	 * @param {Object} [Options] - オプション
	 * @param {string} [Options.identity=''] - Identity
	 * @param {string} [Options.psk=''] - PSK
	 * @param {boolean} [Options.autoGet=true] - 自動状態取得
	 * @param {boolean} [Options.debugMode=false] - デバッグモード
	 * @returns {Promise<Object|null>} identityとpskを含むオブジェクト、キャンセルの場合はnull
	 */
	initialize: async function (securityCode, userFunc, Options = { identity: '', psk: '', autoGet: true, debugMode: false }) {
		// 多重起動防止
		if (Tradfri.enabled) return;
		Tradfri.enabled = true;

		Tradfri.canceled = false;

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

		while (!Object.keys(Tradfri.gw).length) {
			if (Tradfri.canceled) {  // 初期化中にキャンセルがきた
				Tradfri.userFunc(null, 'Canceled', null);
				Tradfri.enabled = false;
				return null;
			}

			try {
				// GWを探す
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

		if (Tradfri.identity === '') { // 新規リンク
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
					// ゲートウェイに到達できないか、応答がありませんでした
					console.error('Error: tradfri-handler.initialize() TradfriErrorCodes.ConnectionTimedOut.');
					console.error('identity:', Tradfri.identity, ', psk:', Tradfri.psk);
					break;
				}
				case TradfriErrorCodes.AuthenticationFailed: {
					// 認証情報が無効です。`authenticate()`を使用して再認証する必要があります。
					console.error('Error: tradfri-handler.identity() TradfriErrorCodes.AuthenticationFailed.');
					console.error('identity:', Tradfri.identity, ', psk:', Tradfri.psk);
					break;
				}
				case TradfriErrorCodes.ConnectionFailed: {
					// 接続時に不明なエラーが発生しました
					console.error('Error: tradfri-handler.identity() TradfriErrorCodes.ConnectionFailed.');
					console.error('identity:', Tradfri.identity, ', psk:', Tradfri.psk);
					break;
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
	/**
	 * 初期化キャンセル
	 */
	initializeCancel: function () {
		Tradfri.canceled = true;
	},

	//====================================================================
	/**
	 * 解放処理
	 * @returns {Promise<void>}
	 */
	release: async function () {
		if (!Tradfri.enabled) return; // 多重開放の防止
		Tradfri.enabled = false;
		await Tradfri.autoGetStop();
		await Tradfri.client.destroy();
	},


	//////////////////////////////////////////////////////////////////////
	// request(options, function (error, response, body) { })
	/**
	 * 状態取得（監視開始）
	 */
	getState: function () {
		// 監視開始
		Tradfri.client.observeDevices();
	},


	/**
	 * デバイスの状態を設定する
	 * @param {number} devId - デバイスID
	 * @param {string} devType - デバイスタイプ ('light' または 'blind')
	 * @param {Object} command - コマンドオブジェクト
	 */
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
	/**
	 * 自動状態取得の開始 (実際には永続的な監視のみ開始)
	 */
	autoGetStart: function () {
		// configファイルにobservationDevsが設定されていれば実施
		Tradfri.debugMode ? console.log('tradfri-handler.autoGetStart()') : 0;
		// Tradfri.client.observeDevices() は永続的なため、cronで繰り返す必要はありません
	},

	/**
	 * 自動状態取得の停止
	 */
	autoGetStop: function () {
		Tradfri.debugMode ? console.log('tradfri-handler.autoGetStop()') : 0;
		// cronジョブは削除されました
	}
};


module.exports = Tradfri;

//////////////////////////////////////////////////////////////////////
// EOF
//////////////////////////////////////////////////////////////////////
