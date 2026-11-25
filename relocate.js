// ==UserScript==
// @name         Ozon Relocate Automation
// @namespace    http://tampermonkey.net/
// @version      5.7
// @description  Быстрая смена ячейки через сканер
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
        } else if (data.address) {
            address = data.address;
            shelfAddress = data.recommendation?.soundCode || data.shelfAddress || data.address;
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

    function isTargetUrl(url) {
        return url.includes('/Movement/put') ||
               url.includes('/clearing/articles/receive') ||
               url.includes('/Resolver/GetResolveEntity') ||
               url.includes('/api2/inbound/articles/resolve-v3');
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
                if (isTargetUrl(this._sUrl)) {
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

        if (isTargetUrl(url)) {
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

            // === АВТО-НАЖАТИЕ КНОПКИ ПОСЛЕ СКАНИРОВАНИЯ ЯЧЕЙКИ ===
            if (isWaitingForCell) {
                e.preventDefault();
                e.stopImmediatePropagation();

                setTimeout(() => {
                    // 1. Ищем по актуальному data-testid кнопки внутри модалки
                    let confirmBtn = document.querySelector('[data-testid="locateButton"]');
                    
                    // 2. Фолбэк: ищем кнопку "Изменить" или "Сохранить" внутри открытой модалки (drawer)
                    if (!confirmBtn) {
                        const modal = document.querySelector('.ozi__drawer__drawer__p1tr_, ._drawer_x5qa8_1');
                        if (modal) {
                            const buttons = modal.querySelectorAll('button');
                            confirmBtn = Array.from(buttons).find(btn => 
                                btn.textContent.trim() === 'Изменить' || btn.textContent.trim() === 'Сохранить'
                            );
                        }
                    }

                    if (confirmBtn) {
                        confirmBtn.click();
                        console.log('Ozon Relocate: Кнопка подтверждения перемещения нажата.');
                    } else {
                        console.warn('Ozon Relocate: Кнопка подтверждения не найдена в модалке.');
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
        if (!logItems || logItems.length === 0) {
            console.warn('Ozon Relocate: Элементы [data-testid="logItem"] не найдены');
            return;
        }

        // === УМНЫЙ ПОИСК: Ищем последний УСПЕШНО принятый товар, игнорируя ошибки ===
        let targetItem = null;
        for (let i = logItems.length - 1; i >= 0; i--) {
            if (logItems[i].querySelector('[data-testid="logItemArticle"]')) {
                targetItem = logItems[i];
                break;
            }
        }

        if (!targetItem) {
            console.warn('Ozon Relocate: Успешные записи в логе не найдены.');
            return;
        }

        // 1. Ищем кнопку открытия модалки перемещения по новому актуальному селектору
        let openDrawerBtn = targetItem.querySelector('[data-testid="openLocateDrawerButton"]');

        // 2. Фолбэк: ищем любую кнопку с текстом "Изменить" внутри этого элемента
        if (!openDrawerBtn) {
            const buttons = targetItem.querySelectorAll('button');
            openDrawerBtn = Array.from(buttons).find(btn => btn.textContent.trim() === 'Изменить');
        }

        if (openDrawerBtn) {
            console.log('Ozon Relocate: Нажимаем кнопку открытия перемещения...');
            openDrawerBtn.click();

            // Ждем открытия модалки и фокусируем инпут для сканера
            try {
                const cellInput = await waitForElement('input[placeholder*="ячейку"], input[placeholder*="Ячейку"], .ozi__drawer__drawer__p1tr_ input', 3000);
                cellInput.click();
                cellInput.focus();
                isWaitingForCell = true;
                console.log('Ozon Relocate: Ожидание сканирования новой ячейки...');
            } catch (err) {
                console.warn('Ozon Relocate: Инпут ячейки в модалке не найден.');
            }
        } else {
            console.error('Ozon Relocate: Кнопка "Изменить" для перемещения не найдена в последнем успешном элементе.');
        }
    }

    function toggleRecommendation() {
        const toggler = document.querySelector('[data-testid="recommendationToggler"]');
        if (toggler) toggler.click();
    }

    function openSearch() {
        const searchIconPath = document.querySelector('svg path[d="M17.892 15.064a8 8 0 1 0-2.828 2.828l2.522 2.522a2 2 0 1 0 2.828-2.828zM11 16a5 5 0 1 1 0-10 5 5 0 0 1 0 10"]');
        if (searchIconPath) {
            const btn = searchIconPath.closest('button');
            if (btn) {
                btn.click();
                setTimeout(() => {
                    const searchInput = document.querySelector('input[placeholder*="Введите или отсканируйте номер отправления"]');
                    if (searchInput) {
                        searchInput.focus();
                        searchInput.value = '';
                        searchInput.dispatchEvent(new Event('input', { bubbles: true }));
                    }
                }, 300);
                return;
            }
        }
        console.warn('Ozon Relocate: Кнопка поиска в хедере не найдена.');
    }

    function closeSearch() {
        const modal = document.querySelector('.ozi__drawer__drawer__p1tr_, ._drawer_x5qa8_1');
        if (modal) {
            const closeBtn = document.querySelector('button._closeIcon_x5qa8_11, button.ozi__window__closeIcon__lcYqb');
            if (closeBtn) {
                closeBtn.click();
                return;
            }
            const escapeEvent = new KeyboardEvent('keydown', {
                key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
            });
            document.dispatchEvent(escapeEvent);
        }
    }

})();
