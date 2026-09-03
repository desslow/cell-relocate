// ==UserScript==
// @name         Ozon Relocate Automation (FIXED ENTER & TIMEOUT)
// @namespace    http://tampermonkey.net/
// @version      5.3-FIX
// @description  Исправлена обработка Enter и таймаутов для проблемных ноутбуков
// @author       desslow
// @match        https://*.ozon.ru/*
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
    
    // Таймаут увеличен до 1000мс (1 секунда). Этого достаточно для любого сканера, 
    // но сбросит буфер, если вы начали печатать руками и замедлились.
    const KEY_TIMEOUT = 1000; 

    console.log("[Relocator] v5.3-FIX запущен. Таймаут:", KEY_TIMEOUT, "мс");

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

    // ДОБАВЛЕНО: Очистка буфера при клике мышкой, чтобы ручной ввод не конфликтовал со сканером
    window.addEventListener('click', () => {
        inputBuffer = '';
        lastKeyTime = Date.now();
    }, true);

    window.addEventListener('keydown', function(e) {
        const currentTime = Date.now();
        const timeDiff = currentTime - lastKeyTime;
        lastKeyTime = currentTime;

        if (timeDiff > KEY_TIMEOUT) {
            if (inputBuffer.length > 0) {
                console.warn(`[Relocator] Буфер сброшен (пауза ${timeDiff}мс). Было: "${inputBuffer}"`);
            }
            inputBuffer = '';
        }

        // РАСШИРЕННОЕ УСЛОВИЕ ДЛЯ ENTER:
        // Ловим обычный Enter, NumpadEnter и старый добрый keyCode 13
        const isEnter = (e.key === 'Enter' || e.key === 'NumpadEnter' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.keyCode === 13);

        if (isEnter) {
            const rawCode = inputBuffer.trim();
            console.log(`[Relocator] Обнаружен Enter. Буфер: "${rawCode}" (длина: ${rawCode.length})`);
            inputBuffer = ''; 

            if (Object.values(TRIGGERS).includes(rawCode) && !isWaitingForCell) {
                e.preventDefault();
                e.stopImmediatePropagation();
                console.log(`[Relocator] ✅ ТРИГГЕР СРАБОТАЛ: ${rawCode}`);

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
                console.log("[Relocator] Скан ячейки завершен. Сохраняем...");

                setTimeout(() => {
                    const saveButton = document.querySelector('[data-testid="saveRelocateBtn"]');
                    if (saveButton) {
                        saveButton.click();
                        console.log("[Relocator] ✅ Сохранено.");
                    } else {
                        console.error("[Relocator] ❌ Кнопка сохранения не найдена.");
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
        console.log("[Relocator] Ищу товар в логах...");
        const logItems = document.querySelectorAll('[data-testid="logItem"]');
        let relocateBtn = null;
        for (let item of logItems) {
            const btn = item.querySelector('[data-testid="relocateBtn"]');
            if (btn) {
                relocateBtn = btn;
                break;
            }
        }

        if (!relocateBtn) {
            console.error("[Relocator] Кнопка 'Изменить' не найдена.");
            return;
        }
        relocateBtn.click();

        try {
            const selectCellInput = await waitForElement('input[placeholder="Выберите ячейку"]');
            selectCellInput.click();
            selectCellInput.focus();
            isWaitingForCell = true;
            console.log("[Relocator] Ожидаю сканирования ячейки...");
        } catch (err) {
            console.error("[Relocator] Ошибка фокусировки:", err.message);
        }
    }

    function toggleRecommendation() {
        const toggler = document.querySelector('[data-testid="recommendationToggler"]');
        if (toggler) {
            toggler.click();
            console.log("[Relocator] Тоггл нажат.");
        } else {
            console.error("[Relocator] Тоггл не найден.");
        }
    }

    function openSearch() {
        window.open('https://turbo-pvz.ozon.ru/search', '_blank');
    }

    function closeSearch() {
        window.close();
    }
})();
