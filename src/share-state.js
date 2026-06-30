(function (root, factory) {
    const api = factory();

    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }

    root.SquashShareState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    function b64encodeUnicode(str) {
        return btoa(
            encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (_, p1) =>
                String.fromCharCode("0x" + p1)
            )
        )
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    }

    function b64decodeUnicode(b64) {
        const s = b64.replace(/-/g, "+").replace(/_/g, "/");
        return decodeURIComponent(
            Array.from(atob(s))
                .map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
                .join("")
        );
    }

    function encodeState(state) {
        return b64encodeUnicode(JSON.stringify(state));
    }

    function decodeState(hash) {
        const value = hash.startsWith("#") ? hash.substring(1) : hash;
        return JSON.parse(b64decodeUnicode(value));
    }

    function createShareUrl(locationLike, state) {
        return `${locationLike.origin}${locationLike.pathname}#${encodeState(state)}`;
    }

    return {
        decodeState,
        createShareUrl
    };
});
