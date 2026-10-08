// ==UserScript==
// @name         Ozon Relocate Automation
// @namespace    http://tampermonkey.net/
// @version      5.3
// @description  Быстрая смена ячейки через сканер + TTS озвучка КГТ ячеек
// @author       desslow
// @match        https://*.ozon.ru/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    const TRIGGERS = {
        RELOCATE: '8888',
        TOGGLE_REC: '0000',
        OPEN_SEARCH: '1111',
        CLOSE_SEARCH: '2222'
    };

    let isWaitingForCell = false;
    let inputBuffer = '';
    let lastKeyTime = Date.now();
    let activeAudio = null;

    function getAudioPartsFromAddress(address, shelfAddress) {
        const parts = [];
        let shelf = (shelfAddress || '').trim();
        let sub = '';

        const fullAddr = (address || '').replace(/\u00a0/g, ' ').trim();

        if (shelf) {
            sub = fullAddr.replace(shelf, '').replace(/^[-_\s]+/, '').trim();
        } else if (fullAddr) {
            const match = fullAddr.match(/^(.*?)[-_]\s*(\d+)$/);
            if (match) {
                shelf = match[1].trim();
                sub = match[2].trim();
            } else {
                shelf = fullAddr;
            }
        }

        if (shelf) {
            const cleanShelf = shelf.toLowerCase();
            parts.push(encodeURIComponent(cleanShelf) + '_male_100.wav');
        }

        if (sub) {
            const cleanSub = sub.toLowerCase();
            parts.push(encodeURIComponent(cleanSub) + '_male_100.wav');
        }

        return parts;
    }

    function stopCurrentAudio() {
        if (activeAudio) {
            try {
                activeAudio.pause();
                activeAudio.currentTime = 0;
            } catch (e) {}
            activeAudio = null;
        }
    }

    async function playAudioSequence(audioFiles) {
        if (!audioFiles || audioFiles.length === 0) return;
        stopCurrentAudio();

        for (const file of audioFiles) {
            await new Promise(resolve => {
                const url = `https://st.ozone.ru/s3/pvz-api-tts/${file}`;
                const audio = new Audio(url);
                activeAudio = audio;
                audio.onended = resolve;
                audio.onerror = () => {
                    resolve();
                };
                audio.play().catch(() => {
                    resolve();
                });
            });
            await new Promise(r => setTimeout(r, 65));
        }
    }

    function handleAddressTtsResponse(data) {
        if (!data) return;

        let address = null;
        let shelfAddress = null;

        if (data.articlePositions && Array.isArray(data.articlePositions) && data.articlePositions[0]) {
            address = data.articlePositions[0].address;
            shelfAddress = data.articlePositions[0].shelfAddress;
        } else if (data.state) {
            address = data.state.address || data.state.shelfAddress;
            shelfAddress = data.state.shelfAddress || address;
        } else if (data.article) {
            address = data.article.address || data.article.shelfAddress;
            shelfAddress = data.article.shelfAddress || address;
        }

        const fullAddrLower = `${address || ''} ${shelfAddress || ''}`.toLowerCase();

        if (!fullAddrLower.includes('кгт')) {
            return;
        }

        const audioFiles = getAudioPartsFromAddress(address, shelfAddress);
        if (audioFiles.length > 0) {
            playAudioSequence(audioFiles);
        }
    }

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._sUrl = typeof url === 'string' ? url : '';
        return origOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        this.addEventListener('load', function() {
            try {
                if (this._sUrl.includes('/Movement/put') ||
                    this._sUrl.includes('/clearing/articles/receive') ||
                    this._sUrl.includes('/Resolver/GetResolveEntity')) {
                    const data = JSON.parse(this.responseText);
                    handleAddressTtsResponse(data);
                }
            } catch (e) {}
        });
        return origSend.apply(this, arguments);
    };

    const origFetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const response = await origFetch.apply(this, args);

        if (url.includes('/Movement/put') ||
            url.includes('/clearing/articles/receive') ||
            url.includes('/Resolver/GetResolveEntity')) {
            response.clone().json().then(handleAddressTtsResponse).catch(() => {});
        }

        return response;
    };

    function waitForElement(selector, timeout = 3000) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            const interval = setInterval(() => {
                const el = document.querySelector(selector);
                if (el) {
                    clearInterval(interval);
                    resolve(el);
                } else if (Date.now() - startTime > timeout) {
                    clearInterval(interval);
                    reject(new Error(`Элемент ${selector} не найден.`));
                }
            }, 100);
        });
    }

    function clearActiveInput() {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            try {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(activeEl, "");
                activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                activeEl.dispatchEvent(new Event('change', { bubbles: true }));
            } catch (err) {
                activeEl.value = '';
            }
        }
    }

    window.addEventListener('keydown', function(e) {
        const currentTime = Date.now();
        if (currentTime - lastKeyTime > 150) {
            inputBuffer = '';
        }
        lastKeyTime = currentTime;

        if (e.key === 'Enter') {
            const rawCode = inputBuffer.trim();
            inputBuffer = '';

            if (Object.values(TRIGGERS).includes(rawCode) && !isWaitingForCell) {
                e.preventDefault();
                e.stopImmediatePropagation();

                clearActiveInput();

                if (rawCode === TRIGGERS.RELOCATE) startRelocationProcess();
                if (rawCode === TRIGGERS.TOGGLE_REC) toggleRecommendation();
                if (rawCode === TRIGGERS.OPEN_SEARCH) openSearch();
                if (rawCode === TRIGGERS.CLOSE_SEARCH) closeSearch();
                return;
            }

            if (isWaitingForCell) {
                e.preventDefault();
                e.stopImmediatePropagation();

                setTimeout(() => {
                    const saveButton = document.querySelector('[data-testid="saveRelocateBtn"]');
                    if (saveButton) {
                        saveButton.click();
                    }
                    isWaitingForCell = false;
                }, 300);
                return;
            }
            return;
        }

        if (!isWaitingForCell && e.key.length === 1) {
            inputBuffer += e.key;
        }
    }, true);

    async function startRelocationProcess() {
        const logItems = document.querySelectorAll('[data-testid="logItem"]');
        let relocateBtn = null;

        for (let item of logItems) {
            const btn = item.querySelector('[data-testid="relocateBtn"]');
            if (btn) {
                relocateBtn = btn;
                break;
            }
        }

        if (!relocateBtn) return;

        relocateBtn.click();

        try {
            const selectCellInput = await waitForElement('input[placeholder="Выберите ячейку"]');
            selectCellInput.click();
            selectCellInput.focus();
            isWaitingForCell = true;
        } catch (err) {}
    }

    function toggleRecommendation() {
        const toggler = document.querySelector('[data-testid="recommendationToggler"]');
        if (toggler) {
            toggler.click();
        }
    }

    function openSearch() {
        window.open('https://turbo-pvz.ozon.ru/search', '_blank');
    }

    function closeSearch() {
        window.close();
    }

})();
