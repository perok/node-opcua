var crypto = require("crypto");
var assert = require("assert");
function makeApplicationUrn(hostname,suffix) {

    // beware : Openssl doesn't support urn with length greater than 64 !!
    //          sometimes hostname length could be too long ...
    // application urn length must not exceed 64 car. to comply with openssl
    // see cryptoCA
    var hostname_hash = crypto.createHash('md5').update(hostname).digest('hex').substr(0,16);

    var applicationUrn = "urn:" + hostname_hash +  ":" + suffix;
    assert(applicationUrn.length<=64);
    return applicationUrn;
}
exports.makeApplicationUrn =makeApplicationUrn;
