(function () {
    'use strict';

    const $ = (sel, ctx = document) => ctx.querySelector(sel);
    const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

    function getSelected(page, name, fallback) {
        return page.querySelector(`input[name="${name}"]:checked`)?.value || fallback;
    }

    function setProtocolContentVisibility(page, protocolType) {
        const general = $('#tab-general', page);
        const generation = $('#tab-generation', page);
        if (general) general.classList.toggle('active', protocolType === 'general');
        if (generation) generation.classList.toggle('active', protocolType === 'by_generation');
    }

    function updateUI(page) {
        if (!page) return;

        const mode = getSelected(page, 'yield-input-mode', 'protocol');
        const protocolOptions = $('#yield-protocol-options', page);
        const countingOptions = $('#yield-counting-options', page);

        if (protocolOptions) protocolOptions.style.display = mode === 'protocol' ? 'flex' : 'none';
        if (countingOptions) countingOptions.style.display = mode === 'counting' ? 'flex' : 'none';

        const protocolType = getProtocolType(page);
        setProtocolContentVisibility(page, protocolType);
    }

    function init(page) {
        if (!page) return;

        ['yield-input-mode', 'yield-protocol-mode', 'yield-counting-mode'].forEach(name => {
            $$(`input[name="${name}"]`, page).forEach(input => {
                input.addEventListener('change', () => updateUI(page));
            });
        });

        updateUI(page);
    }

    function getProtocolType(page) {
        const mode = getSelected(page, 'yield-input-mode', 'protocol');
        if (mode === 'counting') return 'by_generation';
        return getSelected(page, 'yield-protocol-mode', 'general') === 'general' ? 'general' : 'by_generation';
    }

    function getScenario(page) {
        const mode = getSelected(page, 'yield-input-mode', 'protocol');
        if (mode === 'protocol') return 'early_counting';
        return getSelected(page, 'yield-counting-mode', 'early') === 'late' ? 'late_counting' : 'early_counting';
    }

    window.YieldMode = {
        init,
        getProtocolType,
        getScenario,
    };
})();
