"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toCanonicalSignature = exports.toCompactSignature = void 0;
function toCompactSignature(signature) {
    let v = signature.substr(130, 2);
    if (v == "1c") {
        return `${signature.slice(0, 66)}${(parseInt(signature[66], 16) | 8).toString(16)}${signature.slice(67, 130)}`;
    }
    else if (v != "1b") {
        throw ("invalid signature: v should be 27 or 28");
    }
    return signature;
}
exports.toCompactSignature = toCompactSignature;
function toCanonicalSignature(signature) {
    let v = "1c";
    if (parseInt(signature[66], 16) > 7) {
        v = "1e";
    }
    return signature + v;
}
exports.toCanonicalSignature = toCanonicalSignature;
//# sourceMappingURL=utils.js.map