import * as data from './data';
import {TextEncoder, TextDecoder} from '../lib/encoding'; // https://github.com/inexorabletash/text-encoding/issues/44

function signedToUnsigned(signed) {
    return signed >>> 0;
}

function xor(a, b) {
    return signedToUnsigned(a ^ b);
}

function fourBytesToNumber(byte1, byte2, byte3, byte4) {
    return signedToUnsigned(byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4);
}

function numberToFourBytes(number) {
    return [
        (number >>> 24) & 0xFF,
        (number >>> 16) & 0xFF,
        (number >>> 8) & 0xFF,
        number & 0xFF
    ];
}

// https://en.wikipedia.org/wiki/Blowfish_(cipher)
// https://habrahabr.ru/post/140394/ [RUS]
// http://blowfish.online-domain-tools.com/ for tests
class Blowfish {

    // https://en.wikipedia.org/wiki/Block_cipher_mode_of_operation
    static get MODE() {
        return {
            ECB: 'ECB',
            CBC: 'CBC'
        };
    }

    // http://www.di-mgt.com.au/cryptopad.html
    static get PADDING() {
        return {
            PKCS5: 'PKCS5',
            ONE_AND_ZEROS: 'ONE_AND_ZEROS',
            LAST_BYTE: 'LAST_BYTE',
            NULL: 'NULL',
            SPACES: 'SPACES',
        };
    }

    static get TYPE() {
        return {
            STRING: 'STRING',
            UINT8_ARRAY: 'UINT8_ARRAY'
        };
    }

    constructor(key, mode = Blowfish.MODE.ECB, padding = Blowfish.PADDING.PKCS5) {
        const isString = typeof key === 'string';
        const isBuffer = typeof key === 'object' && 'byteLength' in key;
        if (!isString && !isBuffer) {
            throw new Error('Key should be a string or an ArrayBuffer');
        }
        if (Object.keys(Blowfish.MODE).indexOf(mode) < 0) {
            throw new Error(`Unsupported mode "${mode}"`);
        }
        if (Object.keys(Blowfish.PADDING).indexOf(padding) < 0) {
            throw new Error(`Unsupported padding "${padding}"`);
        }
        if (isString) {
            key = (new TextEncoder()).encode(key);
        } else if (isBuffer) {
            key = new Uint8Array(key);
        }

        this.key = key;
        this.mode = mode;
        this.padding = padding;
        this.returnType = Blowfish.TYPE.STRING;
        this.iv = new Uint8Array(0); // todo generate it?
        this.p = data.P;
        this.s = [];
        this.s.push(data.S0);
        this.s.push(data.S1);
        this.s.push(data.S2);
        this.s.push(data.S3);
        this._generateSubkeys();
    }

    setIv(iv) {
        const isString = typeof iv === 'string';
        const isBuffer = typeof iv === 'object' && 'byteLength' in iv;
        if (!isString && !isBuffer) {
            throw new Error('IV should be a string or an ArrayBuffer');
        }
        if (isString) {
            iv = (new TextEncoder()).encode(iv);
        } else if (isBuffer) {
            iv = new Uint8Array(iv);
        }
        if (iv.length !== 8) {
            throw new Error('IV should be 8 byte length');
        }
        this.iv = iv;
    }

    setReturnType(type) {
        if (Object.keys(Blowfish.TYPE).indexOf(type) < 0) {
            throw new Error(`Unsupported return type "${type}"`);
        }
        this.returnType = type;
    }

    encode(data) {
        const isString = typeof data === 'string';
        const isBuffer = typeof data === 'object' && 'byteLength' in data;
        if (!isString && !isBuffer) {
            throw new Error('Encode parameter should be a string or an ArrayBuffer');
        }
        if (isString) {
            data = (new TextEncoder()).encode(data);
        } else if (isBuffer) {
            data = new Uint8Array(data);
        }

        data = this._pad(data);

        switch (this.mode) {
            case Blowfish.MODE.ECB: {
                data = this._encodeECB(data);
                break;
            }
            case Blowfish.MODE.CBC: {
                data = this._encodeCBC(data);
                break;
            }
        }

        switch (this.returnType) {
            case Blowfish.TYPE.UINT8_ARRAY: {
                return data;
            }
            case Blowfish.TYPE.STRING: {
                return (new TextDecoder()).decode(data);
            }
        }
    }

    decode(data) {
        const isString = typeof data === 'string';
        const isBuffer = typeof data === 'object' && 'byteLength' in data;
        if (!isString && !isBuffer) {
            throw new Error('Decode parameter should be a string or an ArrayBuffer');
        }
        if (isString) {
            data = (new TextEncoder()).encode(data);
        } else if (isBuffer) {
            data = new Uint8Array(data);
        }

        if (data.length % 8 !== 0) {
            throw new Error('Decoded string should be multiple of 8 bytes');
        }

        switch (this.mode) {
            case Blowfish.MODE.ECB: {
                data = this._decodeECB(data);
                break;
            }
            case Blowfish.MODE.CBC: {
                data = this._decodeCBC(data);
                break;
            }
        }

        data = this._unpad(data);

        switch (this.returnType) {
            case Blowfish.TYPE.UINT8_ARRAY: {
                return data;
            }
            case Blowfish.TYPE.STRING: {
                return (new TextDecoder()).decode(data);
            }
        }
    }

    _pad(bytes) {
        const count = 8 - bytes.length % 8;
        if (count === 0) { // todo LAST_BYTE can omit it?
            return bytes;
        }
        const writer = new Uint8Array(bytes.length + count);
        const newBytes = [];
        let remaining = count;
        let padChar = 0;

        switch (this.padding) {
            case Blowfish.PADDING.PKCS5: {
                padChar = count;
                break;
            }
            case Blowfish.PADDING.ONE_AND_ZEROS: {
                newBytes.push(0x80);
                remaining--;
                break;
            }
            case Blowfish.PADDING.SPACES: {
                padChar = 0x20;
                break;
            }
        }

        while (remaining > 0) {
            if (this.padding === Blowfish.PADDING.LAST_BYTE && remaining === 1) {
                newBytes.push(count);
                break;
            }
            newBytes.push(padChar);
            remaining--;
        }

        writer.set(bytes);
        writer.set(newBytes, bytes.length);
        return writer;
    }

    _unpad(bytes) {
        let cutLength = 0;
        switch (this.padding) {
            case Blowfish.PADDING.PKCS5: {
                // todo check all chars
                const lastChar = bytes[bytes.length - 1];
                if (lastChar < 8) {
                    cutLength = lastChar;
                }
                break;
            }
            case Blowfish.PADDING.ONE_AND_ZEROS: {
                let i = 1;
                while (i < 8) {
                    const char = bytes[bytes.length - i];
                    if (char === 0x80) {
                        cutLength = i;
                        break;
                    }
                    if (char !== 0) {
                        break;
                    }
                    i++;
                }
                break;
            }
            case Blowfish.PADDING.LAST_BYTE: {
                // todo check all chars
                const lastChar = bytes[bytes.length - 1];
                if (lastChar < 8) { // todo make it < 9 if it is added even when bytes % 8 === 0
                    cutLength = lastChar;
                }
                break;
            }
            case Blowfish.PADDING.NULL:
            case Blowfish.PADDING.SPACES: {
                const padChar = (this.padding === Blowfish.PADDING.SPACES) ? 0x20 : 0;
                let i = 1;
                while (i < 8) {
                    const char = bytes[bytes.length - i];
                    if (char !== padChar) {
                        cutLength = i - 1;
                        break;
                    }
                    i++;
                }
                break;
            }
        }
        return bytes.subarray(0, bytes.length - cutLength);
    }

    _generateSubkeys() {
        // todo check this code
        for (let i = 0, k = 0; i < 18; i++) {
            let longKey = 0;
            for (let j = 0; j < 4; j++, k++) {
                longKey = signedToUnsigned((longKey << 8) | this.key[k % this.key.length]);
            }
            this.p[i] = xor(this.p[i], longKey);
        }
        let l = 0;
        let r = 0;
        for (let i = 0; i < 18; i += 2) {
            [l, r] = this._encryptBlock(l, r);
            this.p[i] = l;
            this.p[i + 1] = r;
        }
        for (let i = 0; i < 4; i++) {
            for (let j = 0; j < 256; j += 2) {
                [l, r] = this._encryptBlock(l, r);
                this.s[i][j] = l;
                this.s[i][j + 1] = r;
            }
        }
    }

    _encryptBlock(l, r) {
        for (let i = 0; i < 16; i++) {
            l = xor(l, this.p[i]);
            r = xor(r, this._f(l));
            [l, r] = [r, l];
        }
        [l, r] = [r, l];
        r = xor(r, this.p[16]);
        l = xor(l, this.p[17]);
        return [l, r];
    }

    _decryptBlock(l, r) {
        // todo check this code carefully
        for (let i = 17; i > 1; i--) {
            l = xor(l, this.p[i]);
            r = xor(r, this._f(l));
            [l, r] = [r, l];
        }
        [l, r] = [r, l];
        r = xor(r, this.p[1]); // todo should these xor's go first?
        l = xor(l, this.p[0]);
        return [l, r];
    }

    _f(x) {
        // todo test this code - operations are signed
        const a = this.s[0][(x >>> 24) & 0xFF];
        const b = this.s[1][(x >>> 16) & 0xFF];
        const c = this.s[2][(x >>> 8) & 0xFF];
        const d = this.s[3][(x) & 0xFF];

        return xor(a + b, c) + d;
    }

    _encodeECB(bytes) {
        const encoded = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i += 8) {
            let l = fourBytesToNumber(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
            let r = fourBytesToNumber(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
            [l, r] = this._encryptBlock(l, r);
            encoded.set(numberToFourBytes(l), i);
            encoded.set(numberToFourBytes(r), i + 4);
        }
        return encoded;
    }

    _encodeCBC(bytes) {
        const encoded = new Uint8Array(bytes.length);
        let prevL = fourBytesToNumber(this.iv[0], this.iv[1], this.iv[2], this.iv[3]);
        let prevR = fourBytesToNumber(this.iv[4], this.iv[5], this.iv[6], this.iv[7]);
        for (let i = 0; i < bytes.length; i += 8) {
            let l = fourBytesToNumber(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
            let r = fourBytesToNumber(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
            [l, r] = [xor(prevL, l), xor(prevR, r)];
            [l, r] = this._encryptBlock(l, r);
            [prevL, prevR] = [l, r];
            encoded.set(numberToFourBytes(l), i);
            encoded.set(numberToFourBytes(r), i + 4);
        }
        return encoded;
    }

    _decodeECB(bytes) {
        const decoded = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i += 8) {
            let l = fourBytesToNumber(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
            let r = fourBytesToNumber(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
            [l, r] = this._decryptBlock(l, r);
            decoded.set(numberToFourBytes(l), i);
            decoded.set(numberToFourBytes(r), i + 4);
        }
        return decoded;
    }

    _decodeCBC(bytes) {
        const decoded = new Uint8Array(bytes.length);
        let prevL = fourBytesToNumber(this.iv[0], this.iv[1], this.iv[2], this.iv[3]);
        let prevR = fourBytesToNumber(this.iv[4], this.iv[5], this.iv[6], this.iv[7]);
        let prevLTmp;
        let prevRTmp;
        for (let i = 0; i < bytes.length; i += 8) {
            let l = fourBytesToNumber(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
            let r = fourBytesToNumber(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7]);
            [prevLTmp, prevRTmp] = [l, r];
            [l, r] = this._decryptBlock(l, r);
            [l, r] = [xor(prevL, l), xor(prevR, r)];
            [prevL, prevR] = [prevLTmp, prevRTmp];
            decoded.set(numberToFourBytes(l), i);
            decoded.set(numberToFourBytes(r), i + 4);
        }
        return decoded;
    }
}

module.exports = Blowfish;
