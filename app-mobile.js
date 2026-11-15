// Capa "app móvil": barra superior, tarjeta héroe, accesos rápidos, barra inferior y hoja "Más".
// No toca tu lógica: solo llama a show(), abrirModalPerfil(), cerrarSesion(), etc.
(function () {
  const TITULOS = { ventas:"Ventas", inventario:"Inventario", historial:"Historial", caja:"Caja", cierres:"Cierres", garantias:"Garantías", admin:"Panel Admin" };
  const $ = (s, r = document) => r.querySelector(s);
  const fmt = n => (window.formatter ? formatter.format(n) : n);

  function go(id) { show(id); document.body.classList.remove("sheet-open"); sync(id); window.scrollTo(0, 0); }
  function sync(id) {
    $(".appbar h1").textContent = TITULOS[id] || "Billing System";
    document.querySelectorAll(".tabbar [data-v]").forEach(b => b.classList.toggle("on", b.dataset.v === id));
  }

  function build() {
    document.body.insertAdjacentHTML("beforeend", `
      <header class="appbar">
        <button class="ab-btn" data-a="perfil" aria-label="Perfil">👤</button>
        <h1>Ventas</h1>
        <button class="ab-btn" data-a="mas" aria-label="Menú">⋯</button>
      </header>
      <nav class="tabbar">
        <button data-v="ventas"><b>🏠</b>Inicio</button>
        <button data-v="inventario"><b>📦</b>Inventario</button>
        <button class="fab" data-v="caja" aria-label="Caja"><b>💵</b></button>
        <button data-v="historial"><b>🧾</b>Historial</button>
        <button data-a="mas"><b>☰</b>Más</button>
      </nav>
      <div class="sheet-bg" data-a="cerrar"></div>
      <div class="sheet" id="sheetMas"></div>`);

    document.body.addEventListener("click", e => {
      const b = e.target.closest("[data-v],[data-a],[data-go]"); if (!b) return;
      if (b.dataset.v) go(b.dataset.v);
      else if (b.dataset.go) go(b.dataset.go);
      else if (b.dataset.a === "mas") { llenarHoja(); document.body.classList.add("sheet-open"); }
      else if (b.dataset.a === "cerrar") document.body.classList.remove("sheet-open");
      else if (b.dataset.a === "perfil") abrirModalPerfil();
      else if (b.dataset.a === "sub") { document.body.classList.remove("sheet-open"); abrirModalSub(); }
      else if (b.dataset.a === "salir") { document.body.classList.remove("sheet-open"); cerrarSesion(); }
    });

    // Hero + accesos rápidos al inicio de Ventas
    $("#ventas")?.insertAdjacentHTML("afterbegin", `
      <div class="hero"><div class="ring" id="hRing"><span id="hPct">0%</span></div>
        <div><small>Saldo en caja</small><strong id="hSaldo">$ 0</strong><small id="hEstado">Caja cerrada</small></div></div>
      <div class="quick">
        <button data-go="inventario"><i>📦</i>Inventario</button>
        <button data-go="caja"><i>💵</i>Caja</button>
        <button data-go="historial"><i>🧾</i>Historial</button>
        <button data-go="garantias"><i>🛡️</i>Garantías</button>
      </div>`);
    setInterval(hero, 1000); hero();
  }

  function llenarHoja() {
    const adm = $("#menuAdmin")?.style.display === "block";
    const sub = $("#menuSubUsuario")?.style.display !== "none";
    $("#sheetMas").innerHTML =
      `<button data-go="cierres">📊 Cierres</button><button data-go="garantias">🛡️ Garantías</button>` +
      (adm ? `<button data-go="admin">⚙️ Panel Admin</button>` : "") +
      (sub ? `<button data-a="sub">👥 Sub-usuarios</button>` : "") +
      `<button class="out" data-a="salir">🚪 Salir</button>`;
  }

  function hero() {
    try {
      $("#hSaldo").textContent = fmt(saldoActual || 0);
      $("#hEstado").textContent = cajaAbierta ? "Caja abierta" : "Caja cerrada";
      const p = saldoActual > 0 ? Math.min(100, Math.round(((saldoActual - (totalRetiros || 0)) / saldoActual) * 100)) : 0;
      $("#hRing").style.setProperty("--p", p); $("#hPct").textContent = p + "%";
    } catch (_) {}
  }

  document.addEventListener("DOMContentLoaded", () => { build(); sync("ventas"); });
})();
