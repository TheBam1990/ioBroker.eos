"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

describe("EOS adapter integration smoke test", () => {
    it("loads io-package metadata used by ioBroker", () => {
        const ioPackagePath = path.join(__dirname, "../..", "io-package.json");
        const ioPackage = JSON.parse(fs.readFileSync(ioPackagePath, "utf8"));

        assert.equal(ioPackage.common.name, "eos");
        assert.equal(ioPackage.common.enabled, true);
        assert.equal(ioPackage.common.compact, true);
    });
});
