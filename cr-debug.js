// ==UserScript==
// @name         Ozon Relocate Automation (DEBUG MODE)
// @namespace    http://tampermonkey.net/
// @version      5.2-DEBUG
// @description  Быстрая смена ячейки через сканер (с расширенным логом)
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
    
    // УВЕЛИЧЕННЫЙ таймаут. Сканеры на разных USB-портах могут "печатать" медленнее.
    const KEY_TIMEOUT = 400; 

    console.log("[Relocator] DEBUG v5.2 запущен. Таймаут буфера:", KEY_TIMEOUT, "мс");

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
        const timeDiff = currentTime - lastKeyTime;
        lastKeyTime = currentTime;

        // --- ОТЛАДОЧНЫЙ ЛОГ (СМОТРИТЕ В КОНСОЛЬ F12) ---
        // console.log(`[DEBUG] Key: "${e.key}", Code: "${e.code}", Diff: ${timeDiff}ms, Buffer: "${inputBuffer}"`);

        if (timeDiff > KEY_TIMEOUT) {
            if (inputBuffer.length > 0) {
                console.warn(`[Relocator] Буфер сброшен из-за таймаута (${timeDiff}мс). Было: "${inputBuffer}"`);
            }
            inputBuffer = '';
        }

        // Ловим Enter (проверяем и key, и code для надежности на разных раскладках)
        if (e.key === 'Enter' || e.code === 'Enter' || e.keyCode === 13) {
            const rawCode = inputBuffer.trim();
            console.log(`[Relocator] Нажат Enter. Итоговый буфер: "${rawCode}"`);
            inputBuffer = ''; // Очищаем сразу после Enter

            if (Object.values(TRIGGERS).includes(rawCode) && !isWaitingForCell) {
                e.preventDefault();
                e.stopImmediatePropagation();
                console.log(`[Relocator] СРАБОТАЛ ТРИГГЕР: ${rawCode}`);

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
                console.log("[Relocator] Скан ячейки завершен. Сохраняем через 300мс...");

                setTimeout(() => {
                    const saveButton = document.querySelector('[data-testid="saveRelocateBtn"]');
                    if (saveButton) {
                        saveButton.click();
                        console.log("[Relocator] Изменения успешно сохранены.");
                    } else {
                        console.error("[Relocator] Кнопка сохранения не найдена.");
                    }
                    isWaitingForCell = false;
                }, 300);
                return;
            }
            return;
        }

        // Собираем только односимвольные ключи (игнорируем Shift, Ctrl, Alt и т.д.)
        if (!isWaitingForCell && e.key.length === 1) {
            inputBuffer += e.key;
        }
    }, true);

    async function startRelocationProcess() {
        console.log("[Relocator] Ищу товар в логах для смены ячейки...");
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
            console.log("[Relocator] Фокус установлен. Ожидаю сканирования ячейки...");
        } catch (err) {
            console.error("[Relocator] Ошибка фокусировки:", err.message);
        }
    }

    function toggleRecommendation() {
        const toggler = document.querySelector('[data-testid="recommendationToggler"]');
        if (toggler) {
            toggler.click();
            console.log("[Relocator] Нажат тоггл 'С рекомендацией'.");
        } else {
            console.error("[Relocator] Тоггл не найден.");
        }
    }

    function openSearch() {
        console.log("[Relocator] Открытие поиска...");
        window.open('https://turbo-pvz.ozon.ru/search', '_blank');
    }

    function closeSearch() {
        console.log("[Relocator] Закрытие вкладки...");
        window.close();
    }
})();
