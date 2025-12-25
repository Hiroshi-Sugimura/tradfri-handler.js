const chai = require('chai');
const expect = chai.expect;
const Tradfri = require('../index.js');

// 結合テストは環境変数が設定されている場合のみ実行
const IKEA_SECURITY_CODE = process.env.IKEA_SECURITY_CODE;
const IKEA_IDENTITY = process.env.IKEA_IDENTITY || '';
const IKEA_PSK = process.env.IKEA_PSK || '';
const TARGET_LIGHT_ID = process.env.TEST_LIGHT_ID;

const describeIntegration = IKEA_SECURITY_CODE ? describe : describe.skip;

describeIntegration('Integration Tests (Hardware Required)', function () {
    this.timeout(60000); // ネットワーク通信を含むため長めに設定

    before(function () {
        if (!IKEA_SECURITY_CODE) {
            console.log('Skipping integration tests: IKEA_SECURITY_CODE not set');
        } else {
            console.log('Starting integration tests with Security Code provided.');
        }
    });

    afterEach(async function () {
        if (Tradfri.enabled) {
            await Tradfri.release();
        }
    });

    it('should connect to actual gateway and get devices', async function () {
        const result = await Tradfri.initialize(IKEA_SECURITY_CODE, null, {
            identity: IKEA_IDENTITY,
            psk: IKEA_PSK,
            debugMode: true // デバッグログを有効化
        });

        // 期待される戻り値
        expect(result).to.have.property('identity');
        expect(result).to.have.property('psk');

        // 状態取得
        await Tradfri.sleep(2000); // デバイス情報が受信されるのを少し待つ

        console.log('Connected GW Address:', Tradfri.gwAddress);
        console.log('Facilities count:', Object.keys(Tradfri.facilities).length);

        expect(Tradfri.gwAddress).to.be.a('string').and.not.empty;
    });

    if (TARGET_LIGHT_ID) {
        it(`should control light (ID: ${TARGET_LIGHT_ID})`, async function () {
            // まず接続
            await Tradfri.initialize(IKEA_SECURITY_CODE, null, {
                identity: IKEA_IDENTITY,
                psk: IKEA_PSK
            });
            await Tradfri.sleep(2000); // デバイス認識待ち

            const lightId = parseInt(TARGET_LIGHT_ID);
            expect(Tradfri.lights).to.have.property(lightId);

            console.log(`Turning Light ${lightId} OFF...`);
            await Tradfri.setState(lightId, 'light', { onOff: false });
            await Tradfri.sleep(2000);

            console.log(`Turning Light ${lightId} ON...`);
            await Tradfri.setState(lightId, 'light', { onOff: true });
            await Tradfri.sleep(2000);

            // 元の状態に戻す等のロジックは入れていないため、テスト後はONになります
        });
    }
});
