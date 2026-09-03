// ==UserScript==
// @name         OZON KEYBOARD TEST
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  ТЕСТ: Ловит ВСЕ клавиши
// @author       desslow
// @match        https://*.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    console.log("✅ СКРИПТ ЗАПУЩЕН. Жду ЛЮБЫХ клавиш...");
    
    // Создаем визуальный индикатор на странице
    const indicator = document.createElement('div');
    indicator.style.cssText = `
        position: fixed;
        top: 10px;
        right: 10px;
        background: #ff0000;
        color: white;
        padding: 20px;
        font-size: 18px;
        z-index: 999999;
        border-radius: 5px;
        box-shadow: 0 0 10px rgba(0,0,0,0.5);
    `;
    indicator.innerHTML = '🔴 ЖДУ КЛАВИШИ...<br><small>Сканируй QR или нажимай кнопки</small>';
    document.body.appendChild(indicator);

    // Ловим ВСЕ keydown (без фильтров)
    window.addEventListener('keydown', function(e) {
        console.log("🔥 КЛАВИША:", e.key, "| Code:", e.code, "| KeyCode:", e.keyCode);
        
        // Меняем индикатор
        indicator.style.background = '#00ff00';
        indicator.innerHTML = `✅ КЛАВИША: <b>${e.key}</b><br>Code: ${e.code}`;
        
        // Возвращаем красный через 2 секунды
        setTimeout(() => {
            indicator.style.background = '#ff0000';
            indicator.innerHTML = '🔴 ЖДУ КЛАВИШИ...<br><small>Сканируй QR или нажимай кнопки</small>';
        }, 2000);
    }, true);

    // Также ловим keyup и keypress для полноты картины
    window.addEventListener('keyup', function(e) {
        console.log("🔼 KEYUP:", e.key);
    }, true);

    window.addEventListener('keypress', function(e) {
        console.log("⌨️ KEYPRESS:", e.key);
    }, true);
})();
