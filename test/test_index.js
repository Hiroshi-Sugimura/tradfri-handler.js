const chai = require('chai');
const expect = chai.expect;
const sinon = require('sinon');
const proxyquire = require('proxyquire');

describe('Tradfri Handler Tests', function () {
    let Tradfri;
    let tradfriLibStub;
    let TradfriClientStub;
    let consoleLogStub;
    let consoleErrorStub;

    // テストのタイムアウトを少し長めに設定
    this.timeout(5000);

    beforeEach(function () {
        // スタブの準備
        TradfriClientStub = class {
            constructor(address) {
                this.address = address;
            }
            authenticate(securityCode) { return Promise.resolve({ identity: 'test_identity', psk: 'test_psk' }); }
            connect(identity, psk) { return Promise.resolve(true); }
            on(event, callback) { }
            observeDevices() { }
            destroy() { }
            operateLight(device, command) { }
            operateBlind(device, command) { }
        };

        tradfriLibStub = {
            TradfriClient: TradfriClientStub,
            discoverGateway: sinon.stub().resolves({ addresses: ['192.168.1.100'] }),
            AccessoryTypes: { lightbulb: 1, blind: 2 },
            TradfriError: class { },
            TradfriErrorCodes: { ConnectionTimedOut: 'ConnectionTimedOut' }
        };

        // コンソール出力の抑制 (テスト結果を見やすくするため)
        consoleLogStub = sinon.stub(console, 'log');
        consoleErrorStub = sinon.stub(console, 'error');

        // モックを注入してTradfriをロード
        // proxyquireはモジュールを再読み込みするため、テスト毎にTradfriオブジェクトは初期化される
        Tradfri = proxyquire('../index.js', {
            'node-tradfri-client': tradfriLibStub
        });
    });

    afterEach(async function () {
        if (Tradfri && Tradfri.enabled) {
            await Tradfri.release();
        }
        sinon.restore();
    });

    describe('Helper Functions', function () {
        it('should return true for empty object', function () {
            expect(Tradfri.isObjEmpty({})).to.be.true;
        });

        it('should return true for null or undefined', function () {
            expect(Tradfri.isObjEmpty(null)).to.be.true;
            expect(Tradfri.isObjEmpty(undefined)).to.be.true;
        });

        it('should return false for non-empty object', function () {
            expect(Tradfri.isObjEmpty({ key: 'value' })).to.be.false;
        });

        it('should sleep for specified duration', async function () {
            const start = Date.now();
            await Tradfri.sleep(100);
            const end = Date.now();
            expect(end - start).to.be.at.least(90); // 多少の誤差を許容
        });
    });

    describe('Initialization', function () {
        it('should initialize successfully', async function () {
            const result = await Tradfri.initialize('security_code', () => { }, { debugMode: true });
            expect(result).to.deep.equal({ identity: 'test_identity', psk: 'test_psk' });
            expect(Tradfri.enabled).to.be.true;
            expect(Tradfri.gwAddress).to.equal('192.168.1.100');
        });

        it('should not initialize if already enabled', async function () {
            // 無理やりtrueにする
            Tradfri.enabled = true;
            // release時に呼ばれるためダミーを設定
            Tradfri.client = { destroy: sinon.stub() };

            const result = await Tradfri.initialize('security_code');
            expect(result).to.be.undefined;
        });

        it('should handle cancellation during initialization', async function () {
            // 30秒待機をスキップするが、キャンセルを挟む隙間を作るために少し待つ
            const sleepStub = sinon.stub(Tradfri, 'sleep').callsFake(() => new Promise(r => setTimeout(r, 10)));

            // GWが見つからない状態をシミュレート（常に空を返す＝ループさせる）
            tradfriLibStub.discoverGateway.reset();
            tradfriLibStub.discoverGateway.resolves({});

            const initPromise = Tradfri.initialize('sec_code');

            // sleep中にキャンセルを実行
            setTimeout(() => {
                Tradfri.initializeCancel();
            }, 50);

            const result = await initPromise;
            expect(result).to.be.null;
            expect(Tradfri.enabled).to.be.false;

            sleepStub.restore();
        });
    });

    describe('Lifecycle & Operations', function () {
        beforeEach(async function () {
            // 前処理として初期化しておく
            await Tradfri.initialize('security_code', () => { }, { autoGet: false });
        });

        it('should release resources and reset state', async function () {
            const destroySpy = sinon.spy(Tradfri.client, 'destroy');

            // 何か値を入れておく
            Tradfri.lights = { 1: {} };

            await Tradfri.release();

            expect(Tradfri.enabled).to.be.false;
            expect(destroySpy.calledOnce).to.be.true;
            // リセット確認
            expect(Tradfri.lights).to.be.empty;
        });

        it('should set state for light', async function () {
            const operateLightSpy = sinon.spy(Tradfri.client, 'operateLight');
            Tradfri.lights[1] = { instanceId: 1 };

            await Tradfri.setState(1, 'light', { onOff: true });

            expect(operateLightSpy.calledOnce).to.be.true;
        });

        it('should set state for blind', async function () {
            const operateBlindSpy = sinon.spy(Tradfri.client, 'operateBlind');
            Tradfri.blinds[2] = { instanceId: 2 };

            await Tradfri.setState(2, 'blind', { position: 50 });

            expect(operateBlindSpy.calledOnce).to.be.true;
        });

        it('should throw error for unknown device type', async function () {
            try {
                await Tradfri.setState(3, 'unknown', {});
                expect.fail('Should have thrown error');
            } catch (e) {
                expect(e.message).to.include('unknown devType');
            }
        });
    });
});
