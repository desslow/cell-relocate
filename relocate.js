// ==UserScript==
// @name         Ozon Relocate Automation
// @namespace    http://tampermonkey.net/
// @version      5.6
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

            // === ИСПРАВЛЕНИЕ: АВТО-НАЖАТИЕ КНОПКИ "ИЗМЕНИТЬ" ПОСЛЕ СКАНИРОВАНИЯ ЯЧЕЙКИ ===
            if (isWaitingForCell) {
                e.preventDefault();
                e.stopImmediatePropagation();

                setTimeout(() => {
                    // 1. Ищем по новому актуальному data-testid
                    let actionButton = document.querySelector('[data-testid="locateButton"]');
                    
                    // 2. Фолбэк на старый data-testid (на случай разных версий UI)
                    if (!actionButton) {
                        actionButton = document.querySelector('[data-testid="saveRelocateBtn"]');
                    }
                    
                    // 3. Фолбэк на поиск кнопки по точному тексту "Изменить"
                    if (!actionButton) {
                        actionButton = Array.from(document.querySelectorAll('button')).find(btn => btn.textContent.trim() === 'Изменить');
                    }

                    if (actionButton) {
                        actionButton.click();
                        console.log('Ozon Relocate: Кнопка "Изменить" нажата автоматически.');
                    } else {
                        console.warn('Ozon Relocate: Кнопка "Изменить" не найдена в DOM.');
                    }
                    
                    isWaitingForCell = false;
                }, 300); // Небольшая задержка, чтобы UI успел обработать ввод сканера
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

        const lastItem = logItems[logItems.length - 1];
        let barcode = lastItem.getAttribute('data-barcode') ||
                      lastItem.getAttribute('data-article') ||
                      lastItem.querySelector('[data-testid="barcode"]')?.textContent?.trim() ||
                      lastItem.querySelector('[data-testid="article"]')?.textContent?.trim();

        if (!barcode) {
            const textContent = lastItem.textContent || '';
            const match = textContent.match(/\b[a-zA-Z0-9]{6,}\b/g);
            if (match) {
                barcode = match.find(b => !/кгт|ячейка|товар|ozon|переместить/i.test(b));
            }
        }

        if (barcode) {
            console.log('Ozon Relocate: Найден штрихкод для перемещения:', barcode);
            try {
                const response = await fetch('https://turbo-pvz.ozon.ru/api2/inbound/articles/resolve-v3', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        barcode: barcode,
                        isArticlePositionRecommendationEnabled: true
                    })
                });

                if (response.ok) {
                    console.log('Ozon Relocate: Успешное перемещение через API (модалка может не открыться, так как бэкенд уже всё сделал).');
                    return; 
                } else {
                    console.error('Ozon Relocate: Ошибка API resolve-v3, статус:', response.status);
                }
            } catch (e) {
                console.error('Ozon Relocate: Исключение при вызове API:', e);
            }
        }

        // Fallback на UI, если API не сработал или штрихкод не найден
        console.log('Ozon Relocate: Попытка найти кнопку перемещения через UI...');
        let relocateBtn = lastItem.querySelector('[data-testid="relocateBtn"]') || lastItem.querySelector('button');
        
        if (relocateBtn) {
            relocateBtn.click();
            try {
                const selectCellInput = await waitForElement('input[placeholder*="ячейку"], input[placeholder*="Ячейку"]', 3000);
                selectCellInput.click();
                selectCellInput.focus();
                isWaitingForCell = true; // Активируем режим ожидания сканирования ячейки
                console.log('Ozon Relocate: Режим ожидания сканирования ячейки активирован.');
            } catch (err) {
                console.warn('Ozon Relocate: Инпут ячейки не найден.');
            }
        } else {
            console.error('Ozon Relocate: Не удалось найти кнопку перемещения или штрихкод.');
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
