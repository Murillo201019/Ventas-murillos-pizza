
    "use strict";
    /* ================= utilidades ================= */
    var $ = function (id) { return document.getElementById(id); };
    function esc(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    var fmtMXN = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
    var fmtMXN0 = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 });
    function money(cents, whole) { return (whole ? fmtMXN0 : fmtMXN).format((cents || 0) / 100); }
    function toCents(text) {
      if (text == null) return null;
      var n = Number(String(text).replace(",", ".").trim());
      if (!isFinite(n) || n < 0) return null;
      return Math.round(n * 100);
    }
    function todayStr() {
      return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Merida", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    }
    function parseDate(s) { var p = String(s).split("-").map(Number); return new Date(p[0] || 2026, (p[1] || 1) - 1, p[2] || 1); }
    function fmtDate(d) {
      var mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
      return d.getFullYear() + "-" + mm + "-" + dd;
    }
    function addDays(s, n) { var d = parseDate(s); d.setDate(d.getDate() + n); return fmtDate(d); }
    function prettyDate(s) {
      return new Intl.DateTimeFormat("es-MX", { weekday: "short", day: "numeric", month: "short" }).format(parseDate(s));
    }
    function prettyMonth(key) {
      var p = key.split("-").map(Number);
      return new Intl.DateTimeFormat("es-MX", { month: "short" }).format(new Date(p[0], (p[1] || 1) - 1, 1));
    }
    var toastTimer = null;
    function toast(msg) {
      var t = $("toast"); t.textContent = msg; t.classList.add("show");
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
    }
    function download(filename, text, mime) {
      var blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }

    /* ================= periodos ================= */
    var PERIODS = [
      { id: "dia", label: "Día" }, { id: "semana", label: "Semana" },
      { id: "mes", label: "Mes" }, { id: "anio", label: "Año" }
    ];
    function periodRange(period, anchor) {
      var d = parseDate(anchor);
      if (period === "dia") return { from: anchor, to: anchor };
      if (period === "semana") {
        var dow = (d.getDay() + 6) % 7;
        var mon = new Date(d); mon.setDate(d.getDate() - dow);
        var sun = new Date(mon); sun.setDate(mon.getDate() + 6);
        return { from: fmtDate(mon), to: fmtDate(sun) };
      }
      if (period === "mes") {
        return { from: fmtDate(new Date(d.getFullYear(), d.getMonth(), 1)), to: fmtDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
      }
      return { from: d.getFullYear() + "-01-01", to: d.getFullYear() + "-12-31" };
    }
    function shiftAnchor(period, anchor, dir) {
      var d = parseDate(anchor);
      if (period === "dia") d.setDate(d.getDate() + dir);
      else if (period === "semana") d.setDate(d.getDate() + dir * 7);
      else if (period === "mes") d.setMonth(d.getMonth() + dir);
      else d.setFullYear(d.getFullYear() + dir);
      return fmtDate(d);
    }

    /* ================= datos (guardados en este teléfono) ================= */
    var LS_KEY = "murillos-ventas-pwa-v1";
    var state = null;
    var storageOK = true;
    function seedState() {
      return {
        v: 1,
        pinHash: null,
        nextId: 100,
        products: [
          { id: 1, name: "Pepperoni", costCents: 4400, priceCents: 18000, slicesPerPizza: 8, slicePriceCents: null, sliceCostCents: null, active: true }
        ],
        sales: [],
        expenses: []
      };
    }
    function loadState() {
      try {
        var raw = window.localStorage.getItem(LS_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.v === 1 && Array.isArray(parsed.products)) { state = parsed; return; }
        }
      } catch (e) { storageOK = false; }
      state = seedState();
      saveState();
    }
    function saveState() {
      try { window.localStorage.setItem(LS_KEY, JSON.stringify(state)); }
      catch (e) { storageOK = false; }
    }
    function nid() { state.nextId = (state.nextId || 100) + 1; return state.nextId; }

    /* PIN: se guarda solo su huella SHA-256, nunca el PIN en claro */
    function hashPin(pin) {
      var data = new TextEncoder().encode("murillos::" + pin);
      if (window.crypto && crypto.subtle && crypto.subtle.digest) {
        return crypto.subtle.digest("SHA-256", data).then(function (buf) {
          return Array.prototype.map.call(new Uint8Array(buf), function (b) {
            return ("0" + b.toString(16)).slice(-2);
          }).join("");
        });
      }
      var h = 5381; var s = "murillos::" + pin;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
      return Promise.resolve("fb" + h.toString(16));
    }
    function verifyPin(pin) {
      if (!state.pinHash) return Promise.resolve(false);
      return hashPin(pin).then(function (h) { return h === state.pinHash; });
    }

    /* ================= catálogo ================= */
    function slicePrice(p) { return p.slicePriceCents != null ? p.slicePriceCents : Math.round(p.priceCents / Math.max(1, p.slicesPerPizza)); }
    function sliceCost(p) { return p.sliceCostCents != null ? p.sliceCostCents : Math.round(p.costCents / Math.max(1, p.slicesPerPizza)); }
    function presetPrice(p, kind) { return kind === "entera" ? p.priceCents : slicePrice(p); }
    function unitCost(p, kind) { return kind === "entera" ? p.costCents : sliceCost(p); }
    function productById(id) {
      for (var i = 0; i < state.products.length; i++) if (state.products[i].id === id) return state.products[i];
      return null;
    }
    var PAYMENTS = [
      { id: "efectivo", label: "Efectivo", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5h.01M18 14.5h.01"/></svg>' },
      { id: "tarjeta", label: "Tarjeta", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19"/></svg>' },
      { id: "transferencia", label: "Transferencia", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18.5h2"/></svg>' }
    ];
    function paymentLabel(id) {
      for (var i = 0; i < PAYMENTS.length; i++) if (PAYMENTS[i].id === id) return PAYMENTS[i].label;
      return id;
    }
    var EXPENSE_CATEGORIES = [
      { id: "insumos", label: "Insumos (harina, queso…)" },
      { id: "gas", label: "Gas / combustible" },
      { id: "empaques", label: "Cajas y empaques" },
      { id: "transporte", label: "Transporte" },
      { id: "otro", label: "Otro" }
    ];
    function categoryLabel(id) {
      for (var i = 0; i < EXPENSE_CATEGORIES.length; i++) if (EXPENSE_CATEGORIES[i].id === id) return EXPENSE_CATEGORIES[i].label;
      return id;
    }

    /* ================= sesión / navegación ================= */
    var ui = {
      mode: "vender",
      adminUnlocked: false,
      adminTab: "resumen",
      period: "dia",
      anchor: todayStr(),
      salePin: null
    };
    function setMode(m) {
      ui.mode = m;
      $("viewVender").hidden = m !== "vender";
      $("viewAdmin").hidden = m !== "admin";
      $("navVender").setAttribute("aria-pressed", m === "vender" ? "true" : "false");
      $("navAdmin").setAttribute("aria-pressed", m === "admin" ? "true" : "false");
      render();
      window.scrollTo({ top: 0 });
    }

    /* ================= modal de PIN (teclado numérico) ================= */
    var pinModalState = null;
    function openPinModal(opts) {
      pinModalState = { pin: "", error: null, busy: false, title: opts.title, onSubmit: opts.onSubmit, onCancel: opts.onCancel || null };
      renderPinModal();
    }
    function closePinModal() { pinModalState = null; $("modalRoot").innerHTML = ""; }
    function renderPinModal() {
      if (!pinModalState) return;
      var pm = pinModalState;
      var keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
      var pad = keys.map(function (k) {
        if (k === "") return "<span></span>";
        return '<button type="button" data-pin="' + k + '" aria-label="' + (k === "del" ? "Borrar dígito" : "Dígito " + k) + '">' + (k === "del" ? "⌫" : k) + "</button>";
      }).join("");
      $("modalRoot").innerHTML =
        '<div class="modal-back" id="pinBack">' +
          '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(pm.title) + '">' +
            "<h2>" + esc(pm.title) + "</h2>" +
            '<p class="desc">Se necesita el PIN del administrador para continuar.</p>' +
            '<div class="pin-dots" aria-label="PIN ingresado">' +
              (pm.pin.length === 0 ? '<span class="ph">••••</span>' : esc("•".repeat(pm.pin.length))) +
            "</div>" +
            (pm.error ? '<p class="err" role="alert">' + esc(pm.error) + "</p>" : "") +
            '<div class="pin-pad">' + pad + "</div>" +
            '<div class="btnrow">' +
              '<button type="button" class="cancel" id="pinCancel">Cancelar</button>' +
              '<button type="button" class="auth" id="pinOk" ' + (pm.pin.length < 4 || pm.busy ? "disabled" : "") + ">" +
                (pm.busy ? "Verificando…" : "Autorizar") + "</button>" +
            "</div>" +
          "</div>" +
        "</div>";
      var padEl = $("modalRoot").querySelector(".pin-pad");
      padEl.addEventListener("click", function (ev) {
        var b = ev.target.closest("button[data-pin]"); if (!b) return;
        var k = b.getAttribute("data-pin");
        if (k === "del") pinModalState.pin = pinModalState.pin.slice(0, -1);
        else if (pinModalState.pin.length < 12) pinModalState.pin += k;
        pinModalState.error = null;
        renderPinModal();
      });
      $("pinCancel").addEventListener("click", function () {
        var cb = pinModalState && pinModalState.onCancel; closePinModal(); if (cb) cb();
      });
      $("pinBack").addEventListener("click", function (ev) {
        if (ev.target === $("pinBack")) { var cb = pinModalState && pinModalState.onCancel; closePinModal(); if (cb) cb(); }
      });
      $("pinOk").addEventListener("click", function () {
        if (!pinModalState || pinModalState.pin.length < 4 || pinModalState.busy) return;
        var pin = pinModalState.pin;
        pinModalState.busy = true; renderPinModal();
        verifyPin(pin).then(function (ok) {
          if (!pinModalState) return;
          if (ok) { var cb = pinModalState.onSubmit; closePinModal(); cb(pin); }
          else { pinModalState.busy = false; pinModalState.pin = ""; pinModalState.error = "PIN incorrecto."; renderPinModal(); }
        });
      });
    }

    /* ================= vista del vendedor ================= */
    var seller = { kind: "entera", cart: [], payment: "efectivo", editingPrice: -1, priceText: "", message: null, error: null, busy: false };
    function cartTotal() { return seller.cart.reduce(function (a, l) { return a + l.unitPriceCents * l.qty; }, 0); }
    function cartCommission() { return seller.payment === "tarjeta" ? Math.round(cartTotal() * 0.032 * 1.16) : 0; }
    function todaySales() {
      var t = todayStr();
      return state.sales.filter(function (s) { return s.saleDate === t && !s.voided; });
    }
    function renderSeller() {
      var el = $("viewVender");
      var ts = todaySales();
      var todayRev = ts.reduce(function (a, s) { return a + s.totalCents; }, 0);
      var products = state.products.filter(function (p) { return p.active; });
      var kind = seller.kind;
      var html = "";
      html += '<section class="oven"><p class="sub">Vendido hoy · ' + esc(prettyDate(todayStr())) + " · " + ts.length + (ts.length === 1 ? " venta" : " ventas") + '</p>' +
        '<p class="big tnum">' + money(todayRev, true) + "</p></section>";
      html += '<div class="seg" role="group" aria-label="Tipo de venta">' +
        '<button type="button" data-kind="entera" aria-pressed="' + (kind === "entera") + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="14.5" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="13" cy="14.5" r="1" fill="currentColor" stroke="none"/></svg>' +
          "Pizza entera</button>" +
        '<button type="button" data-kind="rebanada" aria-pressed="' + (kind === "rebanada") + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5a13 13 0 0 0 16 0l-7.4 14.2a1.5 1.5 0 0 1-2.7-.2L4 5Z"/><circle cx="11" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="7.5" r="1" fill="currentColor" stroke="none"/></svg>' +
          "Por rebanada</button></div>";
      if (products.length === 0) {
        html += '<p class="empty">Todavía no hay pizzas en el menú. El administrador puede agregarlas en la sección Administrador → Productos.</p>';
      } else {
        html += '<div class="grid-pizzas">';
        products.forEach(function (p) {
          html += '<button type="button" class="pizza-card" data-add="' + p.id + '" aria-label="Agregar ' + esc(p.name) + " " + (kind === "entera" ? "entera" : "rebanada") + ", " + money(presetPrice(p, kind), true) + '">' +
            '<span class="name">' + esc(p.name) + "</span>" +
            '<span class="price tnum">' + money(presetPrice(p, kind), true) + "</span>" +
            '<span class="meta">' + (kind === "entera" ? "Pizza entera" : "Rebanada · " + p.slicesPerPizza + " por pizza") + "</span></button>";
        });
        html += "</div>";
      }
      if (seller.cart.length > 0) {
        html += '<section class="card"><h2>Venta actual</h2><ul class="cart-lines">';
        seller.cart.forEach(function (l, idx) {
          html += "<li><div class=\"cart-top\"><div class=\"cart-name\">" + esc(l.name) +
            '<div class="cart-kind">' + (l.kind === "entera" ? "Pizza entera" : "Rebanada") + "</div>";
          if (seller.editingPrice === idx) {
            html += '<span class="price-edit"><span aria-hidden="true">$</span>' +
              '<input id="priceInput" inputmode="decimal" aria-label="Precio de ' + esc(l.name) + '" value="' + esc(seller.priceText) + '">' +
              '<button type="button" data-applyprice="' + idx + '">OK</button></span>';
          } else {
            html += '<button type="button" class="price-btn tnum" data-editprice="' + idx + '" aria-label="Cambiar precio de ' + esc(l.name) + ", actual " + money(l.unitPriceCents) + '">' +
              money(l.unitPriceCents) + " c/u" +
              (l.unitPriceCents !== l.presetCents ? ' <span class="mod">(precio modificado)</span>' : "") + "</button>";
          }
          html += '</div><div class="qty">' +
            '<button type="button" data-qty="' + idx + ':-1" aria-label="Quitar una ' + esc(l.name) + '">−</button>' +
            '<span class="n tnum">' + l.qty + "</span>" +
            '<button type="button" data-qty="' + idx + ':1" aria-label="Agregar una ' + esc(l.name) + '">+</button></div>' +
            '<span class="line-total tnum">' + money(l.unitPriceCents * l.qty, true) + "</span></div></li>";
        });
        html += "</ul>";
        html += '<p style="margin:14px 0 0;font-size:14px;font-weight:600">¿Cómo paga el cliente?</p><div class="pay-grid" role="group" aria-label="Método de pago">';
        PAYMENTS.forEach(function (pm) {
          html += '<button type="button" data-pay="' + pm.id + '" aria-pressed="' + (seller.payment === pm.id) + '">' + pm.icon + esc(pm.label) + "</button>";
        });
        html += "</div>";
        if (seller.payment === "tarjeta") {
          html += '<p class="tnum" style="margin:8px 0 0;font-size:14px;color:var(--dim)">Comisión de la terminal (3.2% + IVA): −' + money(cartCommission()) + " · Recibes " + money(cartTotal() - cartCommission()) + "</p>";
        }
        html += '<div class="total-row"><span class="lbl">Total</span><span class="val tnum">' + money(cartTotal(), true) + "</span></div>";
        if (seller.error) html += '<p class="err" role="alert">' + esc(seller.error) + "</p>";
        html += '<button type="button" class="btn btn-cobrar" id="btnCobrar" ' + (seller.busy ? "disabled" : "") + ">" + (seller.busy ? "Registrando…" : "✓ Cobrar") + "</button>" +
          '<button type="button" class="btn-vaciar" id="btnVaciar">Vaciar venta</button></section>';
      }
      if (seller.message) html += '<p class="success" role="status">' + esc(seller.message) + "</p>";
      if (!storageOK) html += '<p class="empty">Este navegador no permitió guardar en el teléfono: la venta funciona, pero los datos se perderán al cerrar. Abre la app instalada o exporta tu respaldo desde Administrador → Ajustes.</p>';
      el.innerHTML = html;
      bindSeller(el);
      var pi = $("priceInput");
      if (pi) {
        pi.focus(); try { pi.select(); } catch (e) {}
        pi.addEventListener("input", function () { seller.priceText = pi.value; });
        pi.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter") { var c = toCents(seller.priceText); if (c !== null) applyPrice(seller.editingPrice, c); }
        });
      }
    }
    function bindSeller(el) {
      el.querySelectorAll("[data-kind]").forEach(function (b) {
        b.addEventListener("click", function () { seller.kind = b.getAttribute("data-kind"); renderSeller(); });
      });
      el.querySelectorAll("[data-add]").forEach(function (b) {
        b.addEventListener("click", function () { addToCart(Number(b.getAttribute("data-add"))); });
      });
      el.querySelectorAll("[data-qty]").forEach(function (b) {
        b.addEventListener("click", function () {
          var parts = b.getAttribute("data-qty").split(":"); changeQty(Number(parts[0]), Number(parts[1]));
        });
      });
      el.querySelectorAll("[data-editprice]").forEach(function (b) {
        b.addEventListener("click", function () {
          var idx = Number(b.getAttribute("data-editprice"));
          seller.editingPrice = idx; seller.priceText = String(seller.cart[idx].unitPriceCents / 100); renderSeller();
        });
      });
      el.querySelectorAll("[data-applyprice]").forEach(function (b) {
        b.addEventListener("click", function () {
          var c = toCents(seller.priceText); if (c !== null) applyPrice(Number(b.getAttribute("data-applyprice")), c);
        });
      });
      el.querySelectorAll("[data-pay]").forEach(function (b) {
        b.addEventListener("click", function () { seller.payment = b.getAttribute("data-pay"); renderSeller(); });
      });
      var cobrar = $("btnCobrar"); if (cobrar) cobrar.addEventListener("click", checkout);
      var vaciar = $("btnVaciar");
      if (vaciar) vaciar.addEventListener("click", function () { seller.cart = []; ui.salePin = null; seller.error = null; seller.editingPrice = -1; renderSeller(); });
    }
    function addToCart(pid) {
      var p = productById(pid); if (!p) return;
      seller.message = null; seller.error = null;
      var price = presetPrice(p, seller.kind);
      var found = -1;
      for (var i = 0; i < seller.cart.length; i++) {
        var l = seller.cart[i];
        if (l.productId === pid && l.kind === seller.kind && l.unitPriceCents === price) { found = i; break; }
      }
      if (found >= 0) seller.cart[found].qty += 1;
      else seller.cart.push({ productId: pid, name: p.name, kind: seller.kind, qty: 1, unitPriceCents: price, presetCents: price });
      renderSeller();
    }
    function changeQty(idx, delta) {
      if (!seller.cart[idx]) return;
      seller.cart[idx].qty += delta;
      if (seller.cart[idx].qty <= 0) seller.cart.splice(idx, 1);
      if (seller.editingPrice === idx) seller.editingPrice = -1;
      renderSeller();
    }
    function applyPrice(idx, cents) {
      var line = seller.cart[idx]; if (!line) return;
      if (cents !== line.presetCents && !ui.salePin && !ui.adminUnlocked) {
        seller.editingPrice = idx; seller.priceText = String(cents / 100);
        if (!state.pinHash) { seller.error = "Aún no hay PIN de administrador: créalo en la sección Administrador para poder modificar precios."; seller.editingPrice = -1; renderSeller(); return; }
        renderSeller();
        openPinModal({
          title: "Precio modificado",
          onSubmit: function (pin) {
            ui.salePin = pin;
            if (seller.cart[idx]) seller.cart[idx].unitPriceCents = cents;
            seller.editingPrice = -1; renderSeller();
          },
          onCancel: function () { seller.editingPrice = -1; renderSeller(); }
        });
        return;
      }
      line.unitPriceCents = cents; seller.editingPrice = -1; renderSeller();
    }
    function checkout() {
      if (seller.cart.length === 0 || seller.busy) return;
      var hasOverride = seller.cart.some(function (l) { return l.unitPriceCents !== l.presetCents; });
      if (hasOverride && !ui.salePin && !ui.adminUnlocked) {
        if (!state.pinHash) { seller.error = "Aún no hay PIN de administrador: créalo en la sección Administrador para poder modificar precios."; renderSeller(); return; }
        openPinModal({ title: "Precio modificado", onSubmit: function (pin) { ui.salePin = pin; doCheckout(); } });
        return;
      }
      doCheckout();
    }
    function doCheckout() {
      var total = cartTotal();
      var commission = cartCommission();
      var cost = 0;
      var items = seller.cart.map(function (l) {
        var p = productById(l.productId);
        var uc = p ? unitCost(p, l.kind) : 0;
        cost += uc * l.qty;
        return { productId: l.productId, productName: l.name, kind: l.kind, qty: l.qty, unitPriceCents: l.unitPriceCents, unitCostCents: uc };
      });
      var hasOverride = seller.cart.some(function (l) { return l.unitPriceCents !== l.presetCents; });
      state.sales.push({
        id: nid(), saleDate: todayStr(), totalCents: total, costCents: cost, commissionCents: commission,
        paymentMethod: seller.payment, priceOverride: hasOverride, voided: false,
        createdAt: Date.now(), items: items
      });
      saveState();
      seller.message = "¡Venta registrada! " + money(total, true) + " en " + paymentLabel(seller.payment) + ".";
      seller.cart = []; ui.salePin = null; seller.error = null; seller.editingPrice = -1;
      renderSeller();
    }

    /* ================= administrador: acceso ================= */
    var gate = { pin: "", confirm: "", err: null, busy: false };
    function renderAdmin() {
      var el = $("viewAdmin");
      if (!ui.adminUnlocked) { el.innerHTML = gateHTML(); bindGate(el); return; }
      el.innerHTML = adminHTML();
      bindAdmin(el);
    }
    function gateHTML() {
      var hasPin = !!state.pinHash;
      var h = '<div class="gate">' +
        '<svg class="lock-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.3" fill="currentColor" stroke="none"/></svg>' +
        "<h2>" + (hasPin ? "Sección del administrador" : "Crea tu PIN de administrador") + "</h2>" +
        '<p class="desc">' + (hasPin
          ? "Ingresa tu PIN para ver costos, ganancias y estadísticas."
          : "Este PIN protege los costos, las ganancias y los cambios de precio. Elige uno de 4 a 12 dígitos y no lo compartas con el vendedor.") + "</p>" +
        '<form id="gateForm" novalidate>' +
          '<label class="field"><span>' + (hasPin ? "PIN" : "Nuevo PIN") + "</span>" +
            '<input class="input" id="gatePin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="' + esc(gate.pin) + '" aria-label="' + (hasPin ? "PIN de administrador" : "Nuevo PIN de administrador") + '"></label>';
      if (!hasPin) {
        h += '<label class="field"><span>Confirma el PIN</span>' +
          '<input class="input" id="gateConfirm" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="' + esc(gate.confirm) + '" aria-label="Confirmar PIN"></label>';
        if (gate.pin.length >= 4 && gate.confirm.length === 0)
          h += '<p class="err">Escribe el mismo PIN otra vez en «Confirma el PIN» para poder guardarlo.</p>';
        else if (gate.pin.length >= 4 && gate.confirm.length > 0 && gate.pin !== gate.confirm)
          h += '<p class="err">Los dos PIN no coinciden todavía.</p>';
      }
      if (gate.err) h += '<p class="err" role="alert">' + esc(gate.err) + "</p>";
      h += '<button type="submit" class="btn" style="width:100%" ' + (gate.busy ? "disabled" : "") + ">" +
        (gate.busy ? (hasPin ? "Entrando…" : "Guardando…") : (hasPin ? "Entrar" : "Guardar PIN y entrar")) + "</button></form></div>";
      return h;
    }
    function bindGate(el) {
      var pinI = $("gatePin"), confI = $("gateConfirm");
      if (pinI) pinI.addEventListener("input", function () { gate.pin = pinI.value.replace(/\D/g, ""); gate.err = null; renderAdminKeepFocus("gatePin"); });
      if (confI) confI.addEventListener("input", function () { gate.confirm = confI.value.replace(/\D/g, ""); gate.err = null; renderAdminKeepFocus("gateConfirm"); });
      var form = $("gateForm");
      if (form) form.addEventListener("submit", function (ev) { ev.preventDefault(); if (!gate.busy) gateSubmit(); });
    }
    function renderAdminKeepFocus(id) {
      var val = gate[id === "gatePin" ? "pin" : "confirm"];
      renderAdmin();
      var n = $(id);
      if (n) { n.focus(); try { n.setSelectionRange(val.length, val.length); } catch (e) {} }
    }
    function gateSubmit() {
      gate.err = null;
      var hasPin = !!state.pinHash;
      if (hasPin) {
        if (gate.pin.length < 4) { gate.err = "Escribe tu PIN completo (de 4 a 12 dígitos)."; renderAdmin(); return; }
        gate.busy = true; renderAdmin();
        verifyPin(gate.pin).then(function (ok) {
          gate.busy = false;
          if (ok) { ui.adminUnlocked = true; gate.pin = ""; gate.confirm = ""; gate.err = null; renderAdmin(); }
          else { gate.err = "PIN incorrecto. Inténtalo de nuevo."; renderAdmin(); }
        });
        return;
      }
      if (gate.pin.length < 4) { gate.err = "El PIN debe tener al menos 4 dígitos."; renderAdmin(); return; }
      if (gate.confirm.length === 0) { gate.err = "Falta confirmar el PIN: escríbelo otra vez en el segundo campo."; renderAdmin(); return; }
      if (gate.pin !== gate.confirm) { gate.err = "Los dos PIN no coinciden. Escríbelos igual en ambos campos."; renderAdmin(); return; }
      gate.busy = true; renderAdmin();
      hashPin(gate.pin).then(function (h) {
        state.pinHash = h; saveState();
        gate.busy = false; gate.pin = ""; gate.confirm = ""; gate.err = null;
        ui.adminUnlocked = true; renderAdmin();
        toast("PIN guardado. Ya estás en Administrador.");
      });
    }

    /* ================= administrador: panel ================= */
    var adminUI = { confirmVoid: null, confirmDelExpense: null, editingId: null, form: null, formErr: null, formMsg: null,
      exp: { concept: "", amount: "", category: "insumos", date: todayStr(), err: null },
      settings: { newPin: "", err: null, msg: null, confirmWipe: false } };
    function emptyProductForm() { return { name: "", cost: "", price: "", slices: "8", slicePrice: "", sliceCost: "" }; }
    if (!adminUI.form) adminUI.form = emptyProductForm();

    function computeStats(period, from, to) {
      var sales = state.sales.filter(function (s) { return !s.voided && s.saleDate >= from && s.saleDate <= to; });
      var expenses = state.expenses.filter(function (e) { return e.expenseDate >= from && e.expenseDate <= to; });
      var revenue = 0, cost = 0, commission = 0, whole = 0, slices = 0;
      var payMap = {}, prodMap = {}, dayMap = {};
      sales.forEach(function (s) {
        revenue += s.totalCents; cost += s.costCents; commission += s.commissionCents;
        var pm = payMap[s.paymentMethod] || (payMap[s.paymentMethod] = { method: s.paymentMethod, revenueCents: 0, count: 0 });
        pm.revenueCents += s.totalCents; pm.count += 1;
        var key = period === "anio" ? s.saleDate.slice(0, 7) : s.saleDate;
        var dm = dayMap[key] || (dayMap[key] = { label: key, revenueCents: 0, profitCents: 0 });
        dm.revenueCents += s.totalCents; dm.profitCents += s.totalCents - s.costCents - s.commissionCents;
        s.items.forEach(function (it) {
          if (it.kind === "entera") whole += it.qty; else slices += it.qty;
          var pr = prodMap[it.productName] || (prodMap[it.productName] = { name: it.productName, wholeQty: 0, sliceQty: 0, revenueCents: 0, profitCents: 0 });
          if (it.kind === "entera") pr.wholeQty += it.qty; else pr.sliceQty += it.qty;
          pr.revenueCents += it.unitPriceCents * it.qty;
          pr.profitCents += (it.unitPriceCents - it.unitCostCents) * it.qty;
        });
      });
      var expTotal = expenses.reduce(function (a, e) { return a + e.amountCents; }, 0);
      expenses.forEach(function (e) {
        var key = period === "anio" ? e.expenseDate.slice(0, 7) : e.expenseDate;
        var dm = dayMap[key] || (dayMap[key] = { label: key, revenueCents: 0, profitCents: 0 });
        dm.profitCents -= e.amountCents;
      });
      /* Serie completa del periodo (días/meses sin movimiento quedan en cero) */
      var series = [];
      if (period === "anio") {
        var year = from.slice(0, 4);
        for (var m = 1; m <= 12; m++) {
          var k2 = year + "-" + String(m).padStart(2, "0");
          series.push(dayMap[k2] || { label: k2, revenueCents: 0, profitCents: 0 });
        }
      } else {
        var cur = from;
        while (cur <= to) { series.push(dayMap[cur] || { label: cur, revenueCents: 0, profitCents: 0 }); cur = addDays(cur, 1); }
      }
      var byProduct = Object.keys(prodMap).map(function (k) { return prodMap[k]; }).sort(function (a, b) { return b.revenueCents - a.revenueCents; });
      var byPayment = Object.keys(payMap).map(function (k) { return payMap[k]; });
      return {
        revenueCents: revenue, costCents: cost, commissionCents: commission, expensesCents: expTotal,
        profitCents: revenue - cost - commission - expTotal, salesCount: sales.length,
        wholeCount: whole, sliceCount: slices, byPayment: byPayment, byProduct: byProduct, series: series
      };
    }
    function chartSVG(series, period) {
      var W = 680, H = 210, base = 178, topPad = 14;
      var max = 0;
      series.forEach(function (d) { max = Math.max(max, d.revenueCents, d.profitCents); });
      if (max <= 0) max = 1;
      var n = series.length;
      var slot = W / n, bw = Math.min(16, slot / 2 - 3);
      var out = '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Gráfica de ventas y ganancia del periodo">';
      out += '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="var(--border)" stroke-width="1.5"/>';
      series.forEach(function (d, i) {
        var cx = slot * i + slot / 2;
        var rh = Math.round((d.revenueCents / max) * (base - topPad));
        var ph = Math.round((Math.max(0, d.profitCents) / max) * (base - topPad));
        var lbl = period === "anio" ? prettyMonth(d.label) : (d.label.slice(8) + "/" + d.label.slice(5, 7));
        out += "<title>" + esc(lbl) + ": ventas " + money(d.revenueCents, true) + ", ganancia " + money(d.profitCents, true) + "</title>";
        if (rh > 0) out += '<rect x="' + (cx - bw - 2) + '" y="' + (base - rh) + '" width="' + bw + '" height="' + rh + '" rx="3" fill="#c22e1f"/>';
        if (ph > 0) out += '<rect x="' + (cx + 2) + '" y="' + (base - ph) + '" width="' + bw + '" height="' + ph + '" rx="3" fill="#3e7a3a"/>';
        var showLabel = n <= 10 || i % Math.ceil(n / 10) === 0;
        if (showLabel) out += '<text x="' + cx + '" y="' + (base + 18) + '" text-anchor="middle" font-size="11" fill="var(--dim)">' + esc(period === "anio" ? lbl : d.label.slice(8) + "/" + d.label.slice(5, 7)) + "</text>";
      });
      out += "</svg>";
      out += '<div class="legend"><span><i style="background:#c22e1f"></i>Ventas</span><span><i style="background:#3e7a3a"></i>Ganancia</span><span>Máximo: ' + money(max, true) + "</span></div>";
      return out;
    }
    function statCard(label, value, sub) {
      return '<div class="stat"><p class="lbl">' + esc(label) + '</p><p class="val tnum">' + esc(value) + '</p><p class="sub">' + esc(sub) + "</p></div>";
    }
    function periodSalesList(from, to) {
      return state.sales.filter(function (s) { return s.saleDate >= from && s.saleDate <= to; })
        .slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0) || b.id - a.id; }).slice(0, 100);
    }
    function adminHTML() {
      var tabs = [["resumen", "Resumen"], ["productos", "Productos"], ["gastos", "Gastos"], ["ajustes", "Ajustes"]];
      var h = '<div class="admin-head"><h2>Administrador</h2><button type="button" class="btn-lock" id="btnLock">Bloquear</button></div>';
      h += '<div class="tabs" role="group" aria-label="Secciones del administrador">';
      tabs.forEach(function (t) {
        h += '<button type="button" data-tab="' + t[0] + '" aria-pressed="' + (ui.adminTab === t[0]) + '">' + t[1] + "</button>";
      });
      h += "</div>";
      if (ui.adminTab === "resumen") h += resumenHTML();
      else if (ui.adminTab === "productos") h += productosHTML();
      else if (ui.adminTab === "gastos") h += gastosHTML();
      else h += ajustesHTML();
      return h;
    }
    function periodControlsHTML() {
      var range = periodRange(ui.period, ui.anchor);
      var h = '<div class="period-seg" role="group" aria-label="Periodo">';
      PERIODS.forEach(function (p) {
        h += '<button type="button" data-period="' + p.id + '" aria-pressed="' + (ui.period === p.id) + '">' + p.label + "</button>";
      });
      h += '</div><div class="period-nav">' +
        '<button type="button" class="arrow" id="perPrev" aria-label="Periodo anterior">‹</button>' +
        '<div class="mid"><div class="rng">' + (range.from === range.to ? esc(prettyDate(range.from)) : esc(prettyDate(range.from)) + " — " + esc(prettyDate(range.to))) + "</div>" +
        '<input type="date" id="anchorDate" value="' + ui.anchor + '" aria-label="Ir a una fecha">' +
        (ui.anchor !== todayStr() ? '<button type="button" class="hoy" id="perHoy">Hoy</button>' : "") + "</div>" +
        '<button type="button" class="arrow" id="perNext" aria-label="Periodo siguiente">›</button></div>';
      return h;
    }
    function resumenHTML() {
      var range = periodRange(ui.period, ui.anchor);
      var s = computeStats(ui.period, range.from, range.to);
      var h = periodControlsHTML();
      h += '<section class="oven"><p class="sub">Ganancia neta del periodo</p>' +
        '<p class="big tnum' + (s.profitCents < 0 ? " neg" : "") + '">' + money(s.profitCents, true) + "</p>" +
        '<p class="detail tnum">Ventas ' + money(s.revenueCents, true) + " − producción " + money(s.costCents, true) + " − comisión " + money(s.commissionCents, true) + " − gastos " + money(s.expensesCents, true) + "</p></section>";
      h += '<div class="stat-grid">' +
        statCard("Ventas (ingresos)", money(s.revenueCents, true), s.salesCount + " ventas") +
        statCard("Costo de producción", money(s.costCents, true), s.wholeCount + " enteras · " + s.sliceCount + " rebanadas") +
        statCard("Comisión tarjeta", money(s.commissionCents, true), "3.2% + IVA, solo tarjeta") +
        statCard("Gastos registrados", money(s.expensesCents, true), "Insumos y otros") + "</div>";
      var hasActivity = s.series.some(function (d) { return d.revenueCents !== 0 || d.profitCents !== 0; });
      if (hasActivity && !(ui.period === "dia")) {
        h += '<section class="card"><h3>Ventas y ganancia</h3><div class="chart-wrap">' + chartSVG(s.series, ui.period) + "</div></section>";
      }
      if (s.byPayment.length > 0) {
        h += '<section class="card"><h3>Por método de pago</h3><ul class="kv">';
        s.byPayment.forEach(function (bp) {
          h += '<li><span>' + esc(paymentLabel(bp.method)) + ' <span class="c">(' + bp.count + ')</span></span><span class="v tnum">' + money(bp.revenueCents, true) + "</span></li>";
        });
        h += "</ul></section>";
      }
      if (s.byProduct.length > 0) {
        h += '<section class="card"><h3>Por pizza</h3><ul class="list" style="margin-top:6px">';
        s.byProduct.forEach(function (bp) {
          h += '<li style="box-shadow:none"><div class="rowb"><div><div class="ttl">' + esc(bp.name) + '</div><div class="meta">' + bp.wholeQty + " enteras · " + bp.sliceQty + ' rebanadas</div></div>' +
            '<div><div class="amt tnum">' + money(bp.revenueCents, true) + '</div><div class="gain tnum">ganancia ' + money(bp.profitCents, true) + "</div></div></div></li>";
        });
        h += "</ul></section>";
      }
      var list = periodSalesList(range.from, range.to);
      h += '<h3 class="section-title">Ventas del periodo</h3>';
      if (list.length === 0) h += '<p class="empty">No hay ventas registradas en este periodo.</p>';
      else {
        h += '<ul class="list">';
        list.forEach(function (sv) {
          var desc = sv.items.map(function (i) { return i.qty + "× " + i.productName + " (" + i.kind + ")"; }).join(", ");
          h += '<li class="' + (sv.voided ? "voided" : "") + '"><div class="rowb"><div><div class="ttl">' + esc(desc) + '</div>' +
            '<div class="meta">' + esc(prettyDate(sv.saleDate)) + " · " + esc(paymentLabel(sv.paymentMethod)) +
            (sv.commissionCents > 0 ? " · comisión " + money(sv.commissionCents) : "") +
            (sv.priceOverride ? " · precio modificado" : "") + (sv.voided ? " · ANULADA" : "") + "</div></div>" +
            '<div><div class="amt tnum">' + money(sv.totalCents, true) + "</div>" +
            (!sv.voided ? '<div class="gain tnum">ganancia ' + money(sv.totalCents - sv.costCents - sv.commissionCents, true) + "</div>" : "") + "</div></div>";
          if (!sv.voided) {
            if (adminUI.confirmVoid === sv.id) {
              h += '<div class="confirm-row"><button type="button" class="yes" data-void="' + sv.id + '">Sí, anular venta</button><button type="button" class="no" data-voidcancel="1">No</button></div>';
            } else {
              h += '<button type="button" class="link-btn" data-voidask="' + sv.id + '">Anular venta</button>';
            }
          }
          h += "</li>";
        });
        h += "</ul>";
      }
      return h;
    }

    /* ================= administrador: productos ================= */
    function productosHTML() {
      var f = adminUI.form;
      var h = '<section class="card"><h3>' + (adminUI.editingId !== null ? "Editar pizza" : "Agregar pizza al menú") + "</h3>" +
        '<div class="form-grid">' +
        '<label class="field full"><span>Nombre</span><input class="input" id="pfName" value="' + esc(f.name) + '" placeholder="Ej. Pepperoni" aria-label="Nombre de la pizza"></label>' +
        '<label class="field"><span>Costo de producción ($)</span><input class="input" id="pfCost" inputmode="decimal" value="' + esc(f.cost) + '" placeholder="44" aria-label="Costo de producción en pesos"></label>' +
        '<label class="field"><span>Precio de venta ($)</span><input class="input" id="pfPrice" inputmode="decimal" value="' + esc(f.price) + '" placeholder="180" aria-label="Precio de venta en pesos"></label>' +
        '<label class="field"><span>Rebanadas por pizza</span><input class="input" id="pfSlices" inputmode="numeric" value="' + esc(f.slices) + '" aria-label="Rebanadas por pizza"></label><span></span>' +
        '<label class="field"><span>Precio por rebanada ($) — opcional</span><input class="input" id="pfSlicePrice" inputmode="decimal" value="' + esc(f.slicePrice) + '" placeholder="Se calcula solo" aria-label="Precio por rebanada en pesos, opcional"></label>' +
        '<label class="field"><span>Costo por rebanada ($) — opcional</span><input class="input" id="pfSliceCost" inputmode="decimal" value="' + esc(f.sliceCost) + '" placeholder="Se calcula solo" aria-label="Costo por rebanada en pesos, opcional"></label>' +
        "</div>";
      var cp = toCents(f.cost), pp = toCents(f.price);
      if (cp !== null && pp !== null) {
        var sp = Math.max(1, Number(f.slices) || 8);
        var gan = pp - cp;
        h += '<p class="preview tnum" id="pfPreview">Ganancia por pizza entera: <span class="' + (gan >= 0 ? "pos" : "negc") + '">' + money(gan, true) + "</span> · por rebanada: precio " + money(Math.round(pp / sp), true) + ", costo " + money(Math.round(cp / sp), true) + "</p>";
      } else {
        h += '<p class="preview tnum" id="pfPreview" hidden></p>';
      }
      if (adminUI.formErr) h += '<p class="err" role="alert" style="text-align:left">' + esc(adminUI.formErr) + "</p>";
      if (adminUI.formMsg) h += '<p class="okmsg">' + esc(adminUI.formMsg) + "</p>";
      h += '<div style="display:flex;gap:8px;margin-top:14px"><button type="button" class="btn" id="pfSave" style="flex:1">' + (adminUI.editingId !== null ? "Guardar cambios" : "Agregar pizza") + "</button>";
      if (adminUI.editingId !== null) h += '<button type="button" class="btn btn-ghost" id="pfCancel">Cancelar</button>';
      h += '</div><p class="hint" style="margin-top:8px">Si dejas vacío el precio o costo por rebanada, se calcula dividiendo el de la pizza entera entre el número de rebanadas.</p></section>';
      h += '<ul class="list">';
      state.products.forEach(function (p) {
        var profit = p.priceCents - p.costCents;
        var margin = p.priceCents > 0 ? Math.round((profit / p.priceCents) * 100) : 0;
        h += '<li class="' + (p.active ? "" : "voided") + '"><div class="rowb"><div>' +
          '<div class="ttl" style="font-family:\'Bricolage Grotesque\',sans-serif;font-size:18px;font-weight:800">' + esc(p.name) + "</div>" +
          '<div class="meta tnum">Costo ' + money(p.costCents, true) + " · Venta " + money(p.priceCents, true) + " · Rebanada " + money(slicePrice(p), true) + "</div>" +
          '<div class="meta tnum" style="color:var(--green);font-weight:700">Ganancia ' + money(profit, true) + " por entera (" + margin + "%)</div>" +
          (!p.active ? '<div class="meta" style="color:var(--accent);font-weight:700">No se muestra al vendedor</div>' : "") +
          '</div><div class="prod-actions">' +
          '<button type="button" data-editprod="' + p.id + '" aria-label="Editar ' + esc(p.name) + '">Editar</button>' +
          '<button type="button" class="ghostb" data-toggleprod="' + p.id + '" aria-label="' + (p.active ? "Ocultar " + esc(p.name) + " al vendedor" : "Mostrar " + esc(p.name) + " al vendedor") + '">' + (p.active ? "Ocultar" : "Mostrar") + "</button>" +
          "</div></div></li>";
      });
      h += "</ul>";
      return h;
    }
    function readProductForm() {
      adminUI.form = {
        name: $("pfName").value, cost: $("pfCost").value, price: $("pfPrice").value,
        slices: $("pfSlices").value, slicePrice: $("pfSlicePrice").value, sliceCost: $("pfSliceCost").value
      };
    }
    function saveProduct() {
      readProductForm();
      var f = adminUI.form;
      var costCents = toCents(f.cost), priceCents = toCents(f.price);
      var slices = Number(f.slices);
      adminUI.formErr = null; adminUI.formMsg = null;
      if (!f.name.trim()) adminUI.formErr = "Ponle un nombre a la pizza.";
      else if (costCents === null || priceCents === null) adminUI.formErr = "Revisa el costo y el precio de venta.";
      else if (!Number.isInteger(slices) || slices < 1 || slices > 24) adminUI.formErr = "Las rebanadas por pizza deben ser entre 1 y 24.";
      var spc = f.slicePrice.trim() === "" ? null : toCents(f.slicePrice);
      var scc = f.sliceCost.trim() === "" ? null : toCents(f.sliceCost);
      if (!adminUI.formErr && f.slicePrice.trim() !== "" && spc === null) adminUI.formErr = "Revisa el precio por rebanada.";
      if (!adminUI.formErr && f.sliceCost.trim() !== "" && scc === null) adminUI.formErr = "Revisa el costo por rebanada.";
      if (adminUI.formErr) { renderAdmin(); return; }
      if (adminUI.editingId !== null) {
        var p = productById(adminUI.editingId);
        if (p) { p.name = f.name.trim(); p.costCents = costCents; p.priceCents = priceCents; p.slicesPerPizza = slices; p.slicePriceCents = spc; p.sliceCostCents = scc; }
        adminUI.formMsg = "Producto actualizado.";
      } else {
        state.products.push({ id: nid(), name: f.name.trim(), costCents: costCents, priceCents: priceCents, slicesPerPizza: slices, slicePriceCents: spc, sliceCostCents: scc, active: true });
        adminUI.formMsg = "Pizza agregada al menú.";
      }
      saveState();
      adminUI.form = emptyProductForm(); adminUI.editingId = null;
      renderAdmin();
    }

    /* ================= administrador: gastos ================= */
    function gastosHTML() {
      var range = periodRange(ui.period, ui.anchor);
      var ex = adminUI.exp;
      var list = state.expenses.filter(function (e) { return e.expenseDate >= range.from && e.expenseDate <= range.to; })
        .slice().sort(function (a, b) { return b.expenseDate.localeCompare(a.expenseDate) || b.id - a.id; });
      var total = list.reduce(function (a, e) { return a + e.amountCents; }, 0);
      var h = '<section class="card"><h3>Registrar gasto</h3><div style="display:grid;gap:12px;margin-top:12px">' +
        '<label class="field"><span>¿Qué compraste o pagaste?</span><input class="input" id="exConcept" value="' + esc(ex.concept) + '" placeholder="Ej. 5 kg de harina y queso mozzarella" aria-label="Concepto del gasto"></label>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<label class="field"><span>Monto ($)</span><input class="input" id="exAmount" inputmode="decimal" value="' + esc(ex.amount) + '" placeholder="350" aria-label="Monto del gasto en pesos"></label>' +
        '<label class="field"><span>Fecha</span><input class="input" id="exDate" type="date" value="' + esc(ex.date) + '" aria-label="Fecha del gasto"></label></div>' +
        '<label class="field"><span>Categoría</span><select class="input" id="exCategory" aria-label="Categoría del gasto">' +
        EXPENSE_CATEGORIES.map(function (c) { return '<option value="' + c.id + '"' + (ex.category === c.id ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join("") +
        "</select></label>";
      if (ex.err) h += '<p class="err" role="alert" style="text-align:left;margin:0">' + esc(ex.err) + "</p>";
      h += '<button type="button" class="btn" id="exSave" style="width:100%">Guardar gasto</button></div></section>';
      h += '<h3 class="section-title">Gastos del periodo <span class="tnum" style="color:var(--dim)">(' + money(total, true) + ")</span></h3>" +
        '<p class="hint">' + esc(prettyDate(range.from)) + " — " + esc(prettyDate(range.to)) + ". Cambia el periodo en la pestaña Resumen para ver otros gastos.</p>";
      if (list.length === 0) h += '<p class="empty">Sin gastos registrados en este periodo.</p>';
      else {
        h += '<ul class="list">';
        list.forEach(function (e) {
          h += '<li><div class="rowb"><div><div class="ttl">' + esc(e.concept) + '</div><div class="meta">' + esc(prettyDate(e.expenseDate)) + " · " + esc(categoryLabel(e.category)) + "</div></div>" +
            '<div style="display:flex;align-items:center;gap:8px"><span class="amt tnum">' + money(e.amountCents, true) + "</span>";
          if (adminUI.confirmDelExpense === e.id) {
            h += '<button type="button" class="btn btn-small" data-delexp="' + e.id + '" aria-label="Confirmar borrado de ' + esc(e.concept) + '">Borrar</button>' +
              '<button type="button" class="btn btn-ghost btn-small" data-delexpcancel="1">No</button>';
          } else {
            h += '<button type="button" class="link-btn" data-delexpask="' + e.id + '" aria-label="Borrar gasto ' + esc(e.concept) + '">Borrar</button>';
          }
          h += "</div></div></li>";
        });
        h += "</ul>";
      }
      return h;
    }
    function saveExpense() {
      adminUI.exp.concept = $("exConcept").value;
      adminUI.exp.amount = $("exAmount").value;
      adminUI.exp.date = $("exDate").value || todayStr();
      adminUI.exp.category = $("exCategory").value;
      var amountCents = toCents(adminUI.exp.amount);
      adminUI.exp.err = null;
      if (!adminUI.exp.concept.trim()) adminUI.exp.err = "Escribe qué compraste.";
      else if (amountCents === null || amountCents <= 0) adminUI.exp.err = "Escribe el monto del gasto.";
      if (adminUI.exp.err) { renderAdmin(); return; }
      state.expenses.push({ id: nid(), expenseDate: adminUI.exp.date, concept: adminUI.exp.concept.trim(), category: adminUI.exp.category, amountCents: amountCents });
      saveState();
      adminUI.exp.concept = ""; adminUI.exp.amount = "";
      renderAdmin();
      toast("Gasto guardado.");
    }

    /* ================= administrador: ajustes y respaldo ================= */
    function ajustesHTML() {
      var st = adminUI.settings;
      var h = '<section class="card"><h3>Cambiar PIN de administrador</h3>' +
        '<p style="font-size:14px;color:var(--dim);margin:6px 0 0">El PIN autoriza entrar a esta sección y cambiar precios en una venta.</p>' +
        '<label class="field" style="margin-top:12px"><span>Nuevo PIN (4 a 12 dígitos)</span>' +
        '<input class="input" id="setPin" type="password" inputmode="numeric" autocomplete="off" maxlength="12" value="' + esc(st.newPin) + '" aria-label="Nuevo PIN"></label>';
      if (st.err) h += '<p class="err" role="alert" style="text-align:left">' + esc(st.err) + "</p>";
      if (st.msg) h += '<p class="okmsg">' + esc(st.msg) + "</p>";
      h += '<button type="button" class="btn" id="setPinSave" style="width:100%;margin-top:12px" ' + (st.newPin.length < 4 ? "disabled" : "") + ">Guardar nuevo PIN</button></section>";

      h += '<section class="card"><h3>Respaldo de tus datos</h3>' +
        '<p style="font-size:14px;color:var(--dim);margin:6px 0 0">En esta versión instalable, tus pizzas, ventas y gastos se guardan en este teléfono. Descarga un respaldo de vez en cuando para no perderlos si cambias de celular o borras el navegador.</p>' +
        '<div style="display:grid;gap:8px;margin-top:12px">' +
        '<button type="button" class="btn btn-ghost" id="expJSON">Descargar respaldo (archivo)</button>' +
        '<button type="button" class="btn btn-ghost" id="expCSV">Descargar ventas (Excel / CSV)</button>' +
        '<label class="btn btn-ghost" for="impFile" style="cursor:pointer">Restaurar un respaldo</label>' +
        '<input type="file" id="impFile" accept=".json,application/json" hidden>' +
        "</div>";
      if (!st.confirmWipe) {
        h += '<button type="button" class="link-btn" id="wipeAsk" style="margin-top:14px">Borrar todos los datos de esta app…</button>';
      } else {
        h += '<p class="err" style="text-align:left">Esto borra pizzas, ventas, gastos y el PIN de este teléfono. No se puede deshacer. ¿Seguro?</p>' +
          '<div class="confirm-row"><button type="button" class="yes" id="wipeYes">Sí, borrar todo</button><button type="button" class="no" id="wipeNo">Cancelar</button></div>';
      }
      h += "</section>";

      h += '<section class="card"><h3>Cómo se calcula la ganancia</h3><ul class="explain">' +
        "<li><strong>Por pizza:</strong> precio de venta − costo de producción (ejemplo: $180 − $44 = $136).</li>" +
        "<li><strong>Pago con tarjeta:</strong> la terminal cobra 3.2% + IVA (16% sobre la comisión), es decir 3.712% de la venta. Esa comisión se resta de la ganancia automáticamente.</li>" +
        "<li><strong>Ganancia neta del periodo:</strong> ventas − costo de producción de lo vendido − comisiones de tarjeta − gastos registrados (insumos y otros).</li>" +
        "<li><strong>Rebanadas:</strong> si no defines precio o costo por rebanada, se calcula dividiendo el de la pizza entera entre el número de rebanadas.</li>" +
        "</ul></section>";
      return h;
    }
    function exportJSON() {
      download("respaldo-murillos-" + todayStr() + ".json", JSON.stringify(state, null, 2), "application/json");
      toast("Respaldo descargado.");
    }
    function exportCSV() {
      function q(v) { return '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"'; }
      var rows = [["Fecha", "Productos", "Método de pago", "Total", "Costo producción", "Comisión tarjeta", "Ganancia", "Precio modificado", "Anulada"]];
      state.sales.slice().sort(function (a, b) { return a.saleDate.localeCompare(b.saleDate) || a.id - b.id; }).forEach(function (s) {
        rows.push([
          s.saleDate,
          s.items.map(function (i) { return i.qty + "x " + i.productName + " (" + i.kind + ")"; }).join(", "),
          paymentLabel(s.paymentMethod),
          (s.totalCents / 100).toFixed(2), (s.costCents / 100).toFixed(2), (s.commissionCents / 100).toFixed(2),
          ((s.totalCents - s.costCents - s.commissionCents) / 100).toFixed(2),
          s.priceOverride ? "Sí" : "No", s.voided ? "Sí" : "No"
        ]);
      });
      download("ventas-murillos-" + todayStr() + ".csv", "﻿" + rows.map(function (r) { return r.map(q).join(","); }).join("\r\n"), "text/csv;charset=utf-8");
      toast("Ventas descargadas en CSV.");
    }
    function importJSON(file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var parsed = JSON.parse(String(reader.result));
          if (!parsed || !Array.isArray(parsed.products) || !Array.isArray(parsed.sales) || !Array.isArray(parsed.expenses)) throw new Error("bad");
          state = { v: 1, pinHash: parsed.pinHash || null, nextId: Number(parsed.nextId) || 100, products: parsed.products, sales: parsed.sales, expenses: parsed.expenses };
          saveState();
          ui.adminUnlocked = false; seller.cart = [];
          renderAdmin(); setMode("admin");
          toast("Respaldo restaurado. Entra con el PIN del respaldo.");
        } catch (e) { toast("Ese archivo no es un respaldo válido."); }
      };
      reader.readAsText(file);
    }

    /* ================= eventos del panel ================= */
    function bindAdmin(el) {
      var lock = $("btnLock");
      if (lock) lock.addEventListener("click", function () { ui.adminUnlocked = false; gate.pin = ""; gate.confirm = ""; renderAdmin(); });
      el.querySelectorAll("[data-tab]").forEach(function (b) {
        b.addEventListener("click", function () { ui.adminTab = b.getAttribute("data-tab"); renderAdmin(); });
      });
      el.querySelectorAll("[data-period]").forEach(function (b) {
        b.addEventListener("click", function () { ui.period = b.getAttribute("data-period"); renderAdmin(); });
      });
      var prev = $("perPrev"), next = $("perNext"), hoy = $("perHoy"), anchorI = $("anchorDate");
      if (prev) prev.addEventListener("click", function () { ui.anchor = shiftAnchor(ui.period, ui.anchor, -1); renderAdmin(); });
      if (next) next.addEventListener("click", function () { ui.anchor = shiftAnchor(ui.period, ui.anchor, 1); renderAdmin(); });
      if (hoy) hoy.addEventListener("click", function () { ui.anchor = todayStr(); renderAdmin(); });
      if (anchorI) anchorI.addEventListener("change", function () { if (anchorI.value) { ui.anchor = anchorI.value; renderAdmin(); } });
      el.querySelectorAll("[data-voidask]").forEach(function (b) {
        b.addEventListener("click", function () { adminUI.confirmVoid = Number(b.getAttribute("data-voidask")); renderAdmin(); });
      });
      el.querySelectorAll("[data-voidcancel]").forEach(function (b) {
        b.addEventListener("click", function () { adminUI.confirmVoid = null; renderAdmin(); });
      });
      el.querySelectorAll("[data-void]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = Number(b.getAttribute("data-void"));
          state.sales.forEach(function (s) { if (s.id === id) s.voided = true; });
          adminUI.confirmVoid = null; saveState(); renderAdmin(); toast("Venta anulada.");
        });
      });
      /* productos */
      var pfSave = $("pfSave");
      if (pfSave) {
        ["pfName", "pfCost", "pfPrice", "pfSlices", "pfSlicePrice", "pfSliceCost"].forEach(function (id) {
          var n = $(id);
          if (n) n.addEventListener("input", function () { readProductForm(); renderPreviewOnly(); });
        });
        pfSave.addEventListener("click", saveProduct);
      }
      var pfCancel = $("pfCancel");
      if (pfCancel) pfCancel.addEventListener("click", function () { adminUI.editingId = null; adminUI.form = emptyProductForm(); adminUI.formErr = null; renderAdmin(); });
      el.querySelectorAll("[data-editprod]").forEach(function (b) {
        b.addEventListener("click", function () {
          var p = productById(Number(b.getAttribute("data-editprod"))); if (!p) return;
          adminUI.editingId = p.id; adminUI.formErr = null; adminUI.formMsg = null;
          adminUI.form = { name: p.name, cost: String(p.costCents / 100), price: String(p.priceCents / 100), slices: String(p.slicesPerPizza),
            slicePrice: p.slicePriceCents != null ? String(p.slicePriceCents / 100) : "", sliceCost: p.sliceCostCents != null ? String(p.sliceCostCents / 100) : "" };
          renderAdmin(); window.scrollTo({ top: 0, behavior: "smooth" });
        });
      });
      el.querySelectorAll("[data-toggleprod]").forEach(function (b) {
        b.addEventListener("click", function () {
          var p = productById(Number(b.getAttribute("data-toggleprod"))); if (!p) return;
          p.active = !p.active; saveState(); renderAdmin();
        });
      });
      /* gastos */
      var exSave = $("exSave");
      if (exSave) exSave.addEventListener("click", saveExpense);
      el.querySelectorAll("[data-delexpask]").forEach(function (b) {
        b.addEventListener("click", function () { adminUI.confirmDelExpense = Number(b.getAttribute("data-delexpask")); renderAdmin(); });
      });
      el.querySelectorAll("[data-delexpcancel]").forEach(function (b) {
        b.addEventListener("click", function () { adminUI.confirmDelExpense = null; renderAdmin(); });
      });
      el.querySelectorAll("[data-delexp]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = Number(b.getAttribute("data-delexp"));
          state.expenses = state.expenses.filter(function (e) { return e.id !== id; });
          adminUI.confirmDelExpense = null; saveState(); renderAdmin(); toast("Gasto borrado.");
        });
      });
      /* ajustes */
      var setPin = $("setPin");
      if (setPin) setPin.addEventListener("input", function () {
        adminUI.settings.newPin = setPin.value.replace(/\D/g, ""); adminUI.settings.err = null; adminUI.settings.msg = null;
        var btn = $("setPinSave"); if (btn) btn.disabled = adminUI.settings.newPin.length < 4;
        if (setPin.value !== adminUI.settings.newPin) setPin.value = adminUI.settings.newPin;
      });
      var setPinSave = $("setPinSave");
      if (setPinSave) setPinSave.addEventListener("click", function () {
        if (adminUI.settings.newPin.length < 4) return;
        setPinSave.disabled = true; setPinSave.textContent = "Guardando…";
        hashPin(adminUI.settings.newPin).then(function (h) {
          state.pinHash = h; saveState();
          adminUI.settings.newPin = ""; adminUI.settings.err = null;
          adminUI.settings.msg = "PIN actualizado. Úsalo la próxima vez que entres como administrador.";
          renderAdmin();
        });
      });
      var expJ = $("expJSON"); if (expJ) expJ.addEventListener("click", exportJSON);
      var expC = $("expCSV"); if (expC) expC.addEventListener("click", exportCSV);
      var imp = $("impFile");
      if (imp) imp.addEventListener("change", function () { if (imp.files && imp.files[0]) importJSON(imp.files[0]); });
      var wipeAsk = $("wipeAsk");
      if (wipeAsk) wipeAsk.addEventListener("click", function () { adminUI.settings.confirmWipe = true; renderAdmin(); });
      var wipeNo = $("wipeNo");
      if (wipeNo) wipeNo.addEventListener("click", function () { adminUI.settings.confirmWipe = false; renderAdmin(); });
      var wipeYes = $("wipeYes");
      if (wipeYes) wipeYes.addEventListener("click", function () {
        try { window.localStorage.removeItem(LS_KEY); } catch (e) {}
        state = seedState(); saveState();
        ui.adminUnlocked = false; seller.cart = []; adminUI.settings.confirmWipe = false;
        render(); toast("Datos borrados. La app quedó como nueva.");
      });
    }
    function renderPreviewOnly() {
      var pv = $("pfPreview"); if (!pv) return;
      var f = adminUI.form;
      var cp = toCents(f.cost), pp = toCents(f.price);
      if (cp === null || pp === null) { pv.hidden = true; return; }
      var sp = Math.max(1, Number(f.slices) || 8);
      var gan = pp - cp;
      pv.hidden = false;
      pv.innerHTML = 'Ganancia por pizza entera: <span class="' + (gan >= 0 ? "pos" : "negc") + '">' + money(gan, true) + "</span> · por rebanada: precio " + money(Math.round(pp / sp), true) + ", costo " + money(Math.round(cp / sp), true);
    }
    function render() { renderSeller(); renderAdmin(); }

    /* ================= instalación (PWA) ================= */
    var deferredInstall = null;
    var installDismissed = false;
    function isStandalone() {
      return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
    }
    function isIOS() { return /iphone|ipad|ipod/i.test(window.navigator.userAgent); }
    function isFramed() { try { return window.self !== window.top; } catch (e) { return true; } }
    function renderInstall() {
      var area = $("installArea");
      if (isStandalone()) {
        area.innerHTML = '<p class="installed-note">Ya estás usando la app instalada en tu teléfono. Tus datos se guardan en este dispositivo.</p>';
        return;
      }
      if (installDismissed) { area.innerHTML = ""; return; }
      if (isFramed()) {
        area.innerHTML = '<section class="install-card warn"><h2>Primero abre la app sola, fuera de Muse</h2>' +
          "<p>Estás viendo la app <strong>dentro de la página de Muse</strong>. Si eliges «Añadir a pantalla de inicio» desde aquí, Chrome crea el acceso directo de Muse, no el de tu app de ventas: por eso el icono te lleva a muse.ai.</p>" +
          "<ol><li>Toca <strong>«Abrir la app sola»</strong> aquí abajo: la app ocupará toda la pestaña del navegador, ya fuera de Muse.</li>" +
          "<li>Ya con la app sola, abre el menú <strong>⋮</strong> del navegador y elige <strong>«Instalar app»</strong> o <strong>«Añadir a pantalla de inicio»</strong>.</li>" +
          "<li>Si ya se creó un icono de Muse en tu pantalla, bórralo: ese no es el de la app. El bueno dice <strong>Murillo's Ventas</strong> y lleva tu logo.</li></ol>" +
          '<div class="row"><a class="btn" id="btnOpenSolo" target="_top">Abrir la app sola</a>' +
          '<button type="button" class="btn btn-ghost" id="btnInstallHide">Ahora no</button></div>' +
          '<p class="warn-note">Si el botón no abre nada, abre el enlace de la app directamente en Chrome, sin entrar desde la app de Muse, y repite el paso 2 ahí.</p>' +
          "</section>";
        $("btnOpenSolo").href = window.location.href;
        $("btnInstallHide").addEventListener("click", function () { installDismissed = true; renderInstall(); });
        return;
      }
      var steps = isIOS()
        ? "<li>Toca el botón <strong>Compartir</strong> de Safari (el cuadrado con la flecha hacia arriba).</li><li>Elige <strong>«Añadir a pantalla de inicio»</strong>.</li><li>Confirma con <strong>Añadir</strong>: quedará el icono de Murillo's Pizza en tu pantalla.</li>"
        : "<li>Toca el botón <strong>Instalar app</strong> de aquí abajo (o el menú ⋮ de Chrome).</li><li>Elige <strong>«Instalar app»</strong> o <strong>«Añadir a pantalla de inicio»</strong>.</li><li>Ábrela desde el icono de Murillo's Pizza: se verá a pantalla completa, como una app.</li>";
      area.innerHTML = '<section class="install-card"><h2>Instálala en tu celular</h2>' +
        "<p>Esta versión se instala desde el navegador, sin tiendas y sin descargar archivos raros. Funciona con el logo de Murillo's Pizza como icono.</p>" +
        "<ol>" + steps + "</ol>" +
        '<div class="row"><button type="button" class="btn" id="btnInstallMain">Instalar app</button>' +
        '<button type="button" class="btn btn-ghost" id="btnInstallHide">Ahora no</button></div>' +
        (deferredInstall ? "" : '<p class="hint" style="margin-top:10px">Si el botón no abre el instalador, usa el menú del navegador como dicen los pasos: en algunos teléfonos la opción aparece ahí. Ojo: el icono instalado debe decir Murillo\'s Ventas y abrir esta app; si abre Muse, bórralo e instala de nuevo desde la app abierta sola en el navegador.</p>') +
        "</section>";
      $("btnInstallMain").addEventListener("click", doInstall);
      $("btnInstallHide").addEventListener("click", function () { installDismissed = true; renderInstall(); });
    }
    function doInstall() {
      if (isFramed()) {
        installDismissed = false; renderInstall();
        toast("Primero toca «Abrir la app sola» en la tarjeta de arriba; desde ahí sí se instala la app, no Muse.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      if (deferredInstall) {
        var promptFn = deferredInstall.prompt;
        promptFn.call(deferredInstall);
        deferredInstall.userChoice.then(function () { deferredInstall = null; renderInstall(); });
      } else if (isIOS()) {
        toast("En iPhone: botón Compartir → «Añadir a pantalla de inicio».");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        toast("Abre el menú ⋮ de Chrome y toca «Instalar app» o «Añadir a pantalla de inicio».");
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
    window.addEventListener("beforeinstallprompt", function (ev) { ev.preventDefault(); deferredInstall = ev; renderInstall(); });
    window.addEventListener("appinstalled", function () { deferredInstall = null; renderInstall(); toast("¡App instalada! Búscala en tu pantalla de inicio."); });

    /* ================= arranque ================= */
    loadState();
    ui.anchor = todayStr();
    adminUI.exp.date = todayStr();
    $("navVender").addEventListener("click", function () { setMode("vender"); });
    $("navAdmin").addEventListener("click", function () { setMode("admin"); });
    $("btnInstallTop").addEventListener("click", function () {
      if (isStandalone()) { toast("Ya estás en la app instalada."); return; }
      installDismissed = false; renderInstall();
      if (deferredInstall) doInstall(); else window.scrollTo({ top: 0, behavior: "smooth" });
    });
    renderInstall();
    render();
    
if ('serviceWorker' in navigator) { window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function (e) { console.warn('SW no registrado', e); }); }); }
