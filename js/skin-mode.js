(function () {
    'use strict';

    function getBaseInputs() {
        return {
            treeAge: 8,
            protocolType: 'general',
            thinning: {
                branches: 25,
                fronds: 120,
                clusters: 8,
            },
        };
    }

    window.SkinMode = {
        getBaseInputs,
    };
})();
