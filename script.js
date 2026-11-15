// =============================================
// VARIABLES GLOBALES
// =============================================
let inventario    = [];
let historial     = [];
let cierres       = [];
let carrito       = [];
let saldoActual   = 0;
let totalRetiros  = 0;
let cajaAbierta   = false;
let usuarioActivo = null;
let cajaId        = null; // ID del registro de caja en Supabase
let metodosPagoPersonalizados = []; // Métodos de pago del dueño (Nequi, Daviplata, etc.)

const formatter = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP' });

function parsearMonto(str) {
    return parseFloat((str || "0").toString().replace(/\./g, "").replace(",", ".")) || 0;
}
function formatearEntrada(input) {
    let valor = input.value.replace(/\D/g, "");
    if (valor === "") { input.value = ""; return; }
    input.value = new Intl.NumberFormat('es-CO').format(valor);
}

// =============================================
// TOAST
// =============================================
function toast(mensaje, tipo = "success") {
    const colores = {
        success: { bg: "#22c55e", icon: "✅" },
        error:   { bg: "#ef4444", icon: "❌" },
        warning: { bg: "#f59e0b", icon: "⚠️" },
        info:    { bg: "#2563eb", icon: "ℹ️" }
    };
    const { bg, icon } = colores[tipo] || colores.success;
    const t = document.createElement("div");
    t.className = "toast";
    t.style.background = bg;
    t.innerHTML = `<span>${icon} ${mensaje}</span>`;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add("toast-show"), 10);
    setTimeout(() => { t.classList.remove("toast-show"); setTimeout(() => t.remove(), 400); }, 3000);
}

// =============================================
// AUTH
// =============================================
function cambiarPanel(panel) {
    ["loginError","regError","regSuccess"].forEach(id => {
        const el = document.getElementById(id); if (el) el.textContent = "";
    });
    document.querySelectorAll(".auth-panel").forEach(p => p.classList.remove("active"));
    document.getElementById(panel === "login" ? "panelLogin" : "panelRegistro").classList.add("active");
}

function abrirTerminos() {
    document.getElementById("modalTerminos").classList.add("active");
}
function abrirPrivacidad() {
    document.getElementById("modalPrivacidad").classList.add("active");
}
function cerrarModalDoc(event, id) {
    if (event.target === event.currentTarget) cerrarDoc(id);
}
function cerrarDoc(id) {
    const m = document.getElementById(id);
    if (m) m.classList.remove("active");
}

async function registrarUsuario() {
    const nombre   = document.getElementById("regNombre").value.trim();
    const apellido = document.getElementById("regApellido").value.trim();
    const user     = document.getElementById("regUser").value.trim().toLowerCase();
    const email    = document.getElementById("regEmail").value.trim().toLowerCase();
    const empresa  = document.getElementById("regEmpresa").value.trim();
    const pass     = document.getElementById("regPass").value;
    const errEl    = document.getElementById("regError");
    const okEl     = document.getElementById("regSuccess");
    errEl.textContent = ""; okEl.textContent = "";

    if (!nombre || !apellido || !user || !email || !empresa || !pass) { errEl.textContent = "Completa todos los campos."; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = "Ingresa un correo válido."; return; }
    if (pass.length < 6) { errEl.textContent = "Contraseña mínimo 6 caracteres."; return; }
    if (!document.getElementById("aceptaTerminos").checked) { errEl.textContent = "Debes aceptar los términos y condiciones."; return; }
    // Verificar que no sea un usuario admin existente
    const { data: esAdmin } = await sb.from("usuarios").select("id").eq("user_name", user).eq("es_admin", true).single();
    if (esAdmin) { errEl.textContent = "Ese usuario no está disponible."; return; }

    // Verificar si ya existe
    const { data: existe } = await sb.from("usuarios").select("id").eq("user_name", user).maybeSingle();
    if (existe) { errEl.textContent = "Ese usuario ya está en uso."; return; }

    const { error } = await sb.from("usuarios").insert({
        nombre, apellido, user_name: user, email, empresa, pass,
        activo: false, es_admin: false
    });
    if (error) { errEl.textContent = "Error al registrar. Intenta de nuevo."; return; }

    okEl.textContent = "✅ Cuenta creada. Espera a que el administrador te active.";
    ["regNombre","regApellido","regUser","regEmail","regEmpresa","regPass"].forEach(id => document.getElementById(id).value = "");
    setTimeout(() => cambiarPanel("login"), 2000);
}

// Bloqueo de intentos de login
const LOGIN_MAX_INTENTOS = 5;
const LOGIN_BLOQUEO_MS   = 30000; // 30 segundos

function _loginBloqueado() {
    const data = JSON.parse(localStorage.getItem("bs_login_block") || "{}");
    if (!data.hasta) return false;
    if (Date.now() < data.hasta) return Math.ceil((data.hasta - Date.now()) / 1000);
    localStorage.removeItem("bs_login_block");
    return false;
}
function _loginFallo() {
    const data = JSON.parse(localStorage.getItem("bs_login_block") || "{}");
    const intentos = (data.intentos || 0) + 1;
    if (intentos >= LOGIN_MAX_INTENTOS) {
        localStorage.setItem("bs_login_block", JSON.stringify({ intentos, hasta: Date.now() + LOGIN_BLOQUEO_MS }));
    } else {
        localStorage.setItem("bs_login_block", JSON.stringify({ intentos }));
    }
    return intentos;
}
function _loginExito() { localStorage.removeItem("bs_login_block"); }

// ── Sesión única por dispositivo ──
function _generarSessionToken() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
let _sesionCheckInterval = null;

async function _registrarSesion(tabla, id, token) {
    await sb.from(tabla).update({ session_token: token }).eq("id", id);
}

async function _verificarSesionActiva() {
    if (!usuarioActivo) return;
    const token = sessionStorage.getItem("bs_session_token");
    if (!token) { _expulsarSesion("Tu sesión expiró."); return; }
    const tabla = usuarioActivo.es_sub ? "sub_usuarios" : "usuarios";
    const { data } = await sb.from(tabla).select("session_token").eq("id", usuarioActivo.id).maybeSingle();
    if (!data || data.session_token !== token) {
        _expulsarSesion("Tu sesión fue iniciada en otro dispositivo. Esta sesión fue cerrada.");
    }
}

function _expulsarSesion(msg) {
    clearInterval(_sesionCheckInterval); _sesionCheckInterval = null;
    sessionStorage.removeItem("bs_sesion");
    sessionStorage.removeItem("bs_session_token");
    usuarioActivo = null; cajaId = null;
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("ventas")?.classList.add("active");
    mostrarAuth();
    setTimeout(() => { const e = document.getElementById("loginError"); if (e) e.textContent = msg; }, 200);
}

function _iniciarCheckSesion() {
    clearInterval(_sesionCheckInterval);
    _sesionCheckInterval = setInterval(_verificarSesionActiva, 30000);
}

async function iniciarSesion() {
    const user  = document.getElementById("loginUser").value.trim().toLowerCase();
    const pass  = document.getElementById("loginPass").value;
    const errEl = document.getElementById("loginError");
    errEl.textContent = "";

    const bloqueado = _loginBloqueado();
    if (bloqueado) { errEl.textContent = `Demasiados intentos. Espera ${bloqueado}s para intentar de nuevo.`; return; }

    if (!user || !pass) { errEl.textContent = "Completa usuario y contraseña."; return; }

    // Verificar si es sub-usuario
    const { data: subs } = await sb.from("sub_usuarios").select("*, usuarios!inner(*)").eq("user_name", user);
    if (subs && subs.length > 0) {
        const sub = subs.find(s => s.pass === pass);
        if (sub) {
            const dueno = sub.usuarios;
            const acceso = verificarAccesoDueno(dueno);
            if (!acceso.ok) { errEl.textContent = acceso.msg; return; }
            _loginExito();
            const token = _generarSessionToken();
            await _registrarSesion("sub_usuarios", sub.id, token);
            sessionStorage.setItem("bs_session_token", token);
            const { pass: _sp, session_token: _sst, ...subSafe } = sub;
            const { pass: _dp, session_token: _dst, ...duenSafe } = dueno;
            const subObj = { ...subSafe, es_sub: true, dueno_id: duenSafe.id, dueno_user: duenSafe.user_name, empresa: duenSafe.empresa, compartir_inv: sub.compartir_inv, wompi_key: duenSafe.wompi_key };
            sessionStorage.setItem("bs_sesion", JSON.stringify(subObj));
            await activarUsuario(subObj);
            _iniciarCheckSesion();
            ocultarAuth();
            return;
        }
    }

    // Usuario normal — traer solo los campos necesarios (pass incluido solo para verificar, no se guarda en sesión)
    const { data: found } = await sb.from("usuarios")
        .select("id, nombre, apellido, user_name, empresa, email, es_admin, activo, fecha_inicio, fecha_corte, limite_sub, session_token, pass")
        .eq("user_name", user).maybeSingle();
    if (!found || found.pass !== pass) {
        const intentos = _loginFallo();
        const restantes = LOGIN_MAX_INTENTOS - intentos;
        if (restantes > 0) {
            errEl.textContent = `Usuario o contraseña incorrectos. (${restantes} intento${restantes !== 1 ? "s" : ""} restante${restantes !== 1 ? "s" : ""})`;
        } else {
            errEl.textContent = `Demasiados intentos fallidos. Espera ${LOGIN_BLOQUEO_MS / 1000}s para intentar de nuevo.`;
        }
        return;
    }

    if (!found.es_admin) {
        const acceso = verificarAccesoDueno(found);
        if (!acceso.ok) { errEl.textContent = acceso.msg; return; }
    }

    _loginExito();
    const token = _generarSessionToken();
    await _registrarSesion("usuarios", found.id, token);
    // Leer wompi_key por separado para no incluir pass ni datos sensibles en sesión
    const { data: extra } = await sb.from("usuarios").select("wompi_key").eq("id", found.id).maybeSingle();
    sessionStorage.setItem("bs_session_token", token);
    // Guardar sesión SIN pass ni session_token
    const { pass: _p, session_token: _st, ...foundSafe } = found;
    const foundConWompi = { ...foundSafe, wompi_key: extra?.wompi_key || null };
    sessionStorage.setItem("bs_sesion", JSON.stringify(foundConWompi));
    await activarUsuario(foundConWompi);
    _iniciarCheckSesion();
    ocultarAuth();
}

function verificarAccesoDueno(u) {
    if (u.activo) return { ok: true };
    if (!u.fecha_inicio || !u.fecha_corte) return { ok: false, msg: "Tu cuenta no está activa. Contacta al administrador." };
    const hoy    = new Date(); hoy.setHours(0,0,0,0);
    const inicio = new Date(u.fecha_inicio + "T00:00:00");
    const corte  = new Date(u.fecha_corte  + "T23:59:59");
    if (hoy < inicio) return { ok: false, msg: `Tu acceso inicia el ${u.fecha_inicio}.` };
    if (hoy > corte)  return { ok: false, msg: `Tu acceso venció el ${u.fecha_corte}.` };
    return { ok: true };
}

async function activarUsuario(found) {
    usuarioActivo = found;
    if (!found.es_admin) {
        await cargarDatos();
        renderInventario();
        actualizarPanelCaja();
        filtrarHistorial();
        renderCierres();
        verificarBloqueo();
    }
    mostrarBadge(found);
    const menuCliente = document.getElementById("menuCliente");
    const menuAdmin   = document.getElementById("menuAdmin");
    if (found.es_admin) {
        if (menuCliente) menuCliente.style.display = "none";
        if (menuAdmin)   menuAdmin.style.display   = "block";
        show("admin"); renderTablaAdmin();
    } else {
        if (menuCliente) menuCliente.style.display = "block";
        if (menuAdmin)   menuAdmin.style.display   = "none";
        if (found.es_sub) actualizarBadgeSub(found);
        show("ventas");
    }
    verificarPermisoSub();
}

function cerrarSesion() {
    if (!confirm("¿Seguro que quieres cerrar sesión?")) return;
    clearInterval(_sesionCheckInterval); _sesionCheckInterval = null;
    sessionStorage.removeItem("bs_sesion");
    sessionStorage.removeItem("bs_session_token");
    usuarioActivo = null; cajaId = null;
    document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
    document.getElementById("ventas")?.classList.add("active");
    mostrarAuth();
}

function mostrarAuth() {
    document.getElementById("authOverlay").classList.add("active");
    document.getElementById("authOverlay").classList.remove("oculto");
}
function ocultarAuth() {
    const overlay = document.getElementById("authOverlay");
    overlay.classList.add("oculto");
    setTimeout(() => overlay.classList.remove("active"), 400);
}
function mostrarBadge(u) {
    const badge = document.getElementById("userBadge");
    if (badge) badge.textContent = `👤 ${u.nombre}${u.apellido ? " "+u.apellido : ""} · ${u.es_admin ? "Admin" : (u.empresa || "")}`;
}
function actualizarBadgeSub(found) {
    const badge = document.getElementById("userBadge");
    if (badge) badge.innerHTML = `👤 ${found.nombre} <span style="background:#7c3aed;color:white;font-size:0.7rem;padding:1px 6px;border-radius:10px;margin-left:4px;">Sub</span> · ${found.empresa}`;
}

// =============================================
// INIT
// =============================================
// =============================================
// NAVEGACIÓN POR TECLADO
// =============================================
document.addEventListener("keydown", function(e) {
    const tag = document.activeElement?.tagName;
    const enInput = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";

    // Escape → cerrar cualquier modal abierto
    if (e.key === "Escape") {
        if (document.getElementById("modalEscaner")?.classList.contains("active")) { cerrarEscaner(); return; }
        if (document.getElementById("modalRecibo")?.classList.contains("active"))  { cerrarModalRecibo?.(); return; }
        if (document.getElementById("modalVentaExitosa")?.classList.contains("active")) { cerrarModalVentaExitosa?.(); return; }
        if (document.getElementById("modalEditar")?.classList.contains("active"))  { cerrarModalEditar?.(); return; }
        if (document.getElementById("modalTerminos")?.classList.contains("active")) { cerrarDoc("modalTerminos"); return; }
        if (document.getElementById("modalPrivacidad")?.classList.contains("active")) { cerrarDoc("modalPrivacidad"); return; }
        return;
    }

    // Alt + tecla → navegación entre secciones (solo si no está escribiendo)
    if (e.altKey && !enInput) {
        switch(e.key) {
            case "v": case "V": e.preventDefault(); show("ventas");     break;
            case "i": case "I": e.preventDefault(); show("inventario"); break;
            case "c": case "C": e.preventDefault(); show("caja");       break;
            case "h": case "H": e.preventDefault(); show("historial");  break;
            case "r": case "R": e.preventDefault(); show("reportes");   break;
        }
        return;
    }

    // Enter en cantActual (campo de cantidad en el panel de producto) → agregar al carrito
    if (e.key === "Enter" && document.activeElement?.id === "cantActual") {
        e.preventDefault();
        document.getElementById("btnAnadirCarrito")?.click();
        return;
    }

    // Enter en el buscador de ventas (o en cualquier lugar cuando hay producto listo)
    if (e.key === "Enter" && (document.activeElement?.id === "buscar" || document.activeElement?.id === "cantActual" || document.activeElement?.closest("#resultados"))) {
        // Si ya hay un producto seleccionado con botón listo → agregar al carrito
        const btnAnadir = document.getElementById("btnAnadirCarrito");
        if (btnAnadir) {
            e.preventDefault();
            btnAnadir.click();
            return;
        }
        const resultados = document.getElementById("resultados");
        const divs = resultados?.querySelectorAll("div[onclick]");
        if (divs?.length === 1) {
            // Un solo resultado → seleccionarlo
            divs[0].click();
        } else if (!divs || divs.length === 0) {
            // Sin resultados y hay items en carrito → confirmar venta
            const items = document.getElementById("carrito")?.querySelectorAll("li");
            if (items?.length > 0) confirmarVenta?.();
        }
        return;
    }

    // Enter en login (usuario o contraseña) → iniciar sesión
    if (e.key === "Enter" && (document.activeElement?.id === "loginUser" || document.activeElement?.id === "loginPass")) {
        e.preventDefault();
        iniciarSesion?.();
        return;
    }

    // Enter en registro → registrar
    if (e.key === "Enter" && ["regNombre","regApellido","regEmpresa","regUser","regPass"].includes(document.activeElement?.id)) {
        e.preventDefault();
        registrarUsuario?.();
        return;
    }

    // Flechas Arriba/Abajo en resultados de búsqueda de ventas
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && document.getElementById("ventas")?.classList.contains("active")) {
        const resultados = document.getElementById("resultados");
        const divs = Array.from(resultados?.querySelectorAll("div[onclick]") || []);
        if (divs.length === 0) return;
        e.preventDefault();
        const actual = divs.indexOf(document.activeElement);
        if (e.key === "ArrowDown") {
            const siguiente = actual < divs.length - 1 ? actual + 1 : 0;
            divs[siguiente].focus();
        } else {
            const anterior = actual > 0 ? actual - 1 : divs.length - 1;
            divs[anterior].focus();
        }
        return;
    }

    // Enter sobre un resultado de búsqueda enfocado → seleccionarlo
    if (e.key === "Enter" && document.activeElement?.closest("#resultados")) {
        e.preventDefault();
        document.activeElement.click();
        return;
    }

    // Enter en el modal de venta exitosa → cerrarlo
    if (e.key === "Enter" && document.getElementById("modalVentaExitosa")?.classList.contains("active")) {
        e.preventDefault();
        cerrarModalVentaExitosa?.();
        return;
    }
});

document.addEventListener("DOMContentLoaded", async () => {
    _initFisico();   // Activar listener del lector físico de códigos
    const sesion = sessionStorage.getItem("bs_sesion");
    if (sesion) {
        await activarUsuario(JSON.parse(sesion));
        // Verificar de inmediato que el token sigue siendo válido
        await _verificarSesionActiva();
        if (usuarioActivo) _iniciarCheckSesion();
        ocultarAuth();
    } else {
        mostrarAuth();
    }
});



// =============================================
// NAVEGACIÓN
// =============================================
function toggleSidebar() { document.getElementById('sidebar')?.classList.toggle('active'); }
function show(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');
    if (id === "admin") renderTablaAdmin();
}

// =============================================
// CARGAR DATOS
// =============================================
async function cargarDatos() {
    await Promise.all([
        cargarInventario(),
        cargarHistorial(),
        cargarCierres(),
        cargarCaja(),
        cargarMetodosPago()
    ]);
}

async function cargarInventario() {
    if (usuarioActivo.es_sub) {
        if (usuarioActivo.compartir_inv) {
            // Solo este sub tiene compartir_inv activo → ve inventario del dueño
            const { data } = await sb.from("inventario").select("*").eq("dueno_id", usuarioActivo.dueno_id);
            inventario = data || [];
        } else {
            // Sub sin compartir_inv → inventario vacío, solo lo que él agregue con su propio sub_id
            const { data } = await sb.from("inventario").select("*").eq("sub_id", usuarioActivo.id);
            inventario = data || [];
        }
    } else {
        // Dueño → su propio inventario
        const { data } = await sb.from("inventario").select("*").eq("dueno_id", usuarioActivo.id).is("sub_id", null);
        inventario = data || [];
    }
}

async function cargarHistorial() {
    const col = usuarioActivo.es_sub ? "sub_usuario_id" : "usuario_id";
    const id  = usuarioActivo.es_sub ? usuarioActivo.id  : usuarioActivo.id;
    const { data } = await sb.from("ventas").select("*, venta_items(*)").eq(col, id).order("fecha", { ascending: false });
    historial = (data || []).map(v => ({
        id: v.id,
        fecha:    new Date(v.fecha).toLocaleString(),
        fechaISO: v.fecha,
        total:    v.total,
        cantProd: v.cant_productos,
        items: (v.venta_items || []).map(i => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precio, esMinimo: i.es_minimo }))
    }));
}

async function cargarCierres() {
    const col = usuarioActivo.es_sub ? "sub_usuario_id" : "usuario_id";
    const id  = usuarioActivo.id;
    const { data } = await sb.from("cierres").select("*").eq(col, id).order("fecha", { ascending: false });
    cierres = (data || []).map(c => ({
        fecha:    new Date(c.fecha).toLocaleString(),
        fechaISO: c.fecha,
        saldoFinal: c.saldo_final,
        totalRetiros: c.total_retiros,
        productosVendidos: c.productos_vendidos,
        detalleVentas: c.detalle_ventas || []
    }));
}

async function cargarCaja() {
    const col = usuarioActivo.es_sub ? "sub_usuario_id" : "usuario_id";
    const id  = usuarioActivo.id;
    const { data } = await sb.from("caja").select("*").eq(col, id).maybeSingle();
    if (data) {
        cajaId       = data.id;
        saldoActual  = data.saldo_actual;
        totalRetiros = data.total_retiros;
        cajaAbierta  = data.caja_abierta;
    } else {
        // Crear registro de caja si no existe
        const nuevo = { saldo_actual: 0, total_retiros: 0, caja_abierta: false };
        if (usuarioActivo.es_sub) nuevo.sub_usuario_id = usuarioActivo.id;
        else nuevo.usuario_id = usuarioActivo.id;
        const { data: creada } = await sb.from("caja").insert(nuevo).select().single();
        if (creada) cajaId = creada.id;
        saldoActual = 0; totalRetiros = 0; cajaAbierta = false;
    }
}

// =============================================
// MÉTODOS DE PAGO PERSONALIZADOS
// =============================================

async function cargarMetodosPago() {
    const duenId = usuarioActivo.es_sub ? usuarioActivo.dueno_id : usuarioActivo.id;
    const { data } = await sb.from("metodos_pago").select("*").eq("dueno_id", duenId).order("created_at", { ascending: true });
    metodosPagoPersonalizados = data || [];
}

function abrirConfigMetodosPago() {
    renderListaMetodosPago();
    document.getElementById("modalConfigMetodosPago").classList.add("active");
    document.getElementById("modalConfigMetodosPago").classList.remove("oculto");
}

function cerrarConfigMetodosPago() {
    const m = document.getElementById("modalConfigMetodosPago");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
    limpiarFormMetodoPago();
}

function renderListaMetodosPago() {
    const lista = document.getElementById("listaMetodosPago");
    if (!lista) return;
    if (metodosPagoPersonalizados.length === 0) {
        lista.innerHTML = `<p style="color:#888;text-align:center;padding:16px 0;">No tienes métodos de pago configurados.</p>`;
        return;
    }
    lista.innerHTML = metodosPagoPersonalizados.map(m => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:#fff;">
            <div style="display:flex;align-items:center;gap:10px;">
                <div>
                    <div style="font-weight:600;font-size:0.9rem;color:#1e293b;">${_etiquetaMetodo(m.tipo)}${m.nombre_comercial ? ' · ' + m.nombre_comercial : ''}</div>
                    <div style="font-size:0.78rem;color:#64748b;">${m.numero || ''}${m.nombre_titular ? ' · ' + m.nombre_titular : ''}</div>
                </div>
            </div>
            <button onclick="eliminarMetodoPago('${m.id}')" style="background:none;border:none;cursor:pointer;color:#e53e3e;font-size:1.1rem;padding:4px 8px;" title="Eliminar">🗑️</button>
        </div>
    `).join("");
}

function _etiquetaMetodo(tipo) {
    const labels = {
        nequi:"Nequi", nequi_comercio:"Nequi Comercio", daviplata:"Daviplata",
        bancolombia_ahorro:"Bancolombia Ahorro", bancolombia_corriente:"Bancolombia Corriente",
        wompi_qr:"Wompi QR", efectivo:"Efectivo", otro:"Otro"
    };
    return labels[tipo] || tipo;
}

function limpiarFormMetodoPago() {
    ["mpTipo","mpNombreComercial","mpNombreTitular","mpNumero","mpNumeroCuenta","mpNIT","mpClave"].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = "";
    });
    const qrPrev = document.getElementById("mpQRPreview");
    if (qrPrev) qrPrev.innerHTML = "";
    window._mpQRBase64 = null;
    const fi = document.getElementById("mpQRInput"); if (fi) fi.value = "";
    // Ocultar todos los grupos
    ["mpNombreComercialGroup","mpTitularGroup","mpNITGroup","mpCelularGroup","mpCuentaGroup",
     "mpClaveGroup","mpQRGroup","mpNotaPSE","mpBtnAgregar"].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = "none";
    });
}

function mpTipoChanged() {
    const tipo = document.getElementById("mpTipo")?.value;

    // Ocultar todo primero
    ["mpNombreComercialGroup","mpTitularGroup","mpNITGroup","mpCelularGroup","mpCuentaGroup",
     "mpClaveGroup","mpQRGroup","mpNotaPSE","mpBtnAgregar"].forEach(id => {
        const el = document.getElementById(id); if (el) el.style.display = "none";
    });
    if (!tipo) return;

    const show = id => { const el = document.getElementById(id); if (el) el.style.display = ""; };
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    // Prellenar nombre comercial por defecto
    const nombresPorTipo = {
        nequi: "Nequi", nequi_comercio: "Nequi Comercio", daviplata: "Daviplata",
        bancolombia_ahorro: "Bancolombia Ahorro", bancolombia_corriente: "Bancolombia Corriente",
        wompi_qr: "Wompi QR", otro: ""
    };
    const ncEl = document.getElementById("mpNombreComercial");
    if (ncEl && !ncEl.value) ncEl.value = nombresPorTipo[tipo] || "";

    if (tipo === "nequi") {
        show("mpNombreComercialGroup");
        setText("mpNombreComercialLabel", "Nombre visible para el cliente");
        show("mpTitularGroup");
        setText("mpTitularLabel", "Nombre del titular (como aparece en Nequi)");
        show("mpCelularGroup");
        show("mpClaveGroup");
        show("mpQRGroup");
        setText("mpQRLabel", "QR de Nequi (opcional)");
    } else if (tipo === "nequi_comercio") {
        show("mpNombreComercialGroup");
        setText("mpNombreComercialLabel", "Nombre del comercio");
        show("mpNITGroup");
        show("mpQRGroup");
        setText("mpQRLabel", "QR de Nequi Comercio");
    } else if (tipo === "daviplata") {
        show("mpNombreComercialGroup");
        setText("mpNombreComercialLabel", "Nombre visible para el cliente");
        show("mpTitularGroup");
        setText("mpTitularLabel", "Nombre del titular (como aparece en Daviplata)");
        show("mpCelularGroup");
        show("mpClaveGroup");
        show("mpQRGroup");
        setText("mpQRLabel", "QR de Daviplata (opcional)");
    } else if (tipo === "bancolombia_ahorro" || tipo === "bancolombia_corriente") {
        show("mpNombreComercialGroup");
        setText("mpNombreComercialLabel", "Nombre del titular de la cuenta");
        show("mpCuentaGroup");
        show("mpQRGroup");
        setText("mpQRLabel", "QR de Bancolombia (opcional)");
    } else if (tipo === "wompi_qr") {
        show("mpNombreComercialGroup");
        setText("mpNombreComercialLabel", "Nombre que verá el cliente");
        show("mpQRGroup");
        setText("mpQRLabel", "QR de Wompi (obligatorio)");
    } else if (tipo === "otro") {
        show("mpNombreComercialGroup");
        setText("mpNombreComercialLabel", "Nombre del método de pago");
        show("mpTitularGroup");
        setText("mpTitularLabel", "Nombre del titular (opcional)");
        show("mpCelularGroup");
        show("mpQRGroup");
        setText("mpQRLabel", "QR (opcional)");
    }

    show("mpBtnAgregar");
}

function mpQRSeleccionado(input) {
    const file = input.files[0]; if (!file) return;
    if (!file.type.startsWith("image/")) { toast("Selecciona una imagen válida.", "error"); return; }
    const reader = new FileReader();
    reader.onload = e => {
        window._mpQRBase64 = e.target.result;
        const prev = document.getElementById("mpQRPreview");
        if (prev) prev.innerHTML = `<img src="${e.target.result}" style="max-width:140px;max-height:140px;border-radius:8px;border:1px solid #e2e8f0;">`;
    };
    reader.readAsDataURL(file);
}

async function guardarMetodoPago() {
    const tipo            = document.getElementById("mpTipo")?.value;
    const nombreComercial = document.getElementById("mpNombreComercial")?.value.trim();
    const nombreTitular   = document.getElementById("mpNombreTitular")?.value.trim();
    // Número: celular (Nequi/Daviplata) o cuenta (Bancolombia)
    const numeroCelular   = document.getElementById("mpNumero")?.value.trim();
    const numeroCuenta    = document.getElementById("mpNumeroCuenta")?.value.trim();
    const nit             = document.getElementById("mpNIT")?.value.trim();
    const numero          = numeroCuenta || numeroCelular || nit || null;
    const clave           = document.getElementById("mpClave")?.value.trim();
    const qrBase64        = window._mpQRBase64 || null;

    if (!tipo) { toast("Selecciona el tipo de método.", "error"); return; }
    if (tipo === "wompi_qr" && !qrBase64) { toast("Agrega el QR de Wompi.", "error"); return; }
    // wompi_qr no tiene número; efectivo tampoco
    const sinNumero = ["efectivo", "wompi_qr"];
    if (!numero && !sinNumero.includes(tipo)) { toast("El número es obligatorio.", "error"); return; }

    const duenId = usuarioActivo.es_sub ? usuarioActivo.dueno_id : usuarioActivo.id;
    const payload = { dueno_id: duenId, tipo, nombre_comercial: nombreComercial, nombre_titular: nombreTitular, numero, clave_brev: clave, qr_base64: qrBase64 };

    const { data, error } = await sb.from("metodos_pago").insert(payload).select().single();
    if (error) { toast("Error al guardar: " + error.message, "error"); return; }

    metodosPagoPersonalizados.push(data);
    renderListaMetodosPago();
    limpiarFormMetodoPago();
    toast("Método de pago agregado ✓", "success");
}

async function eliminarMetodoPago(id) {
    if (!confirm("¿Eliminar este método de pago?")) return;
    const { error } = await sb.from("metodos_pago").delete().eq("id", id);
    if (error) { toast("Error al eliminar.", "error"); return; }
    metodosPagoPersonalizados = metodosPagoPersonalizados.filter(m => m.id !== id);
    renderListaMetodosPago();
    toast("Método eliminado.", "success");
}

function mostrarDetalleMetodoPago(id) {
    const m = metodosPagoPersonalizados.find(x => x.id === id);
    if (!m) return;
    const total = carrito.reduce((s, p) => s + p.precio * p.cantidad, 0);
    document.getElementById("dmpNombre").textContent    = m.nombre_comercial || m.tipo;
    document.getElementById("dmpTitular").textContent   = m.nombre_titular || "—";
    document.getElementById("dmpNumero").textContent    = m.numero || "—";
    document.getElementById("dmpClave").textContent     = m.clave_brev || "—";
    document.getElementById("dmpTotal").textContent     = formatter.format(total);
    const qrEl = document.getElementById("dmpQR");
    if (m.qr_base64) {
        qrEl.innerHTML    = `<img src="${m.qr_base64}" style="max-width:180px;max-height:180px;border-radius:8px;">`;
        qrEl.style.display = "block";
    } else {
        qrEl.innerHTML = ""; qrEl.style.display = "none";
    }
    window._dmpMetodoActual = id;
    document.getElementById("modalDetalleMetodoPago").classList.add("active");
    document.getElementById("modalDetalleMetodoPago").classList.remove("oculto");
}

function cerrarDetalleMetodoPago() {
    const m = document.getElementById("modalDetalleMetodoPago");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

async function confirmarPagoMetodo() {
    cerrarDetalleMetodoPago();
    const m = metodosPagoPersonalizados.find(x => x.id === window._dmpMetodoActual);
    await finalizarVenta(m?.nombre_comercial || m?.tipo || "transferencia");
}

// =============================================
// LECTOR DE CÓDIGOS DE BARRAS
// =============================================

// ── Estado del escáner de cámara ──
let _escanerStream   = null;   // MediaStream activo
let _escanerTimer    = null;   // interval de captura
let _escanerActivo   = false;
let _escanerContexto = "ventas"; // 'ventas' | 'inventario' | 'reabastecer'

// ── Lector físico (infrarrojo/láser): simulan teclado ──
// Acumulamos teclas rápidas; si llegan ≥4 chars en <80ms y termina en Enter → es un escáner
let _scanBuffer = "";
let _scanTimer  = null;

function _initFisico() {
    document.addEventListener("keydown", function(e) {
        // Solo cuando la vista de ventas está activa
        const ventasVisible = document.getElementById("ventas")?.classList.contains("active");
        const modalAbierto  = document.getElementById("modalEscaner")?.classList.contains("active");
        if (!ventasVisible || modalAbierto) return;

        if (e.key === "Enter") {
            if (_scanBuffer.length >= 3) {
                const codigo = _scanBuffer.trim();
                _scanBuffer = "";
                clearTimeout(_scanTimer);
                // Detectar contexto según vista activa
                if (document.getElementById("inventario")?.classList.contains("active")) {
                    const focusedId = document.activeElement?.id;
                    _escanerContexto = focusedId === "reabastecerID" ? "reabastecer" : "inventario";
                } else {
                    _escanerContexto = "ventas";
                }
                _onCodigoLeido(codigo, "físico");
            } else {
                _scanBuffer = "";
            }
            return;
        }
        if (e.key && e.key.length === 1) {   // carácter imprimible
            _scanBuffer += e.key;
            clearTimeout(_scanTimer);
            _scanTimer = setTimeout(() => { _scanBuffer = ""; }, 120);
        }
    });
}

// ── Resultado común para ambos métodos ──
function _onCodigoLeido(codigo, fuente) {
    const ctx = fuente === "físico" ? _escanerContexto : _escanerContexto;

    // ── INVENTARIO: rellenar campo ID para registrar producto nuevo ──
    if (_escanerContexto === "inventario") {
        cerrarEscaner();
        document.getElementById("id").value = codigo;
        document.getElementById("nombre").focus();
        toast(`🔖 ID ${codigo} cargado — completa los demás campos`, "success");
        return;
    }

    // ── REABASTECER: rellenar campo ID y enfocar cantidad ──
    if (_escanerContexto === "reabastecer") {
        cerrarEscaner();
        document.getElementById("reabastecerID").value = codigo;
        document.getElementById("reabastecerCant").focus();
        // Si el producto ya existe, mostrar su nombre como confirmación
        const p = inventario.find(x => x.prod_id?.toString() === codigo);
        if (p) toast(`📦 ${p.nombre} — ingresa la cantidad a sumar`, "success");
        else   toast(`ID ${codigo} cargado — verifica que exista en inventario`, "warning");
        return;
    }

    // ── VENTAS: buscar producto y preparar venta ──
    let p = inventario.find(x => x.prod_id?.toString() === codigo);
    if (!p) p = inventario.find(x => x.nombre?.toLowerCase() === codigo.toLowerCase());

    if (p) {
        cerrarEscaner();
        // Ya está en carrito → sumar 1 directo, sin mostrar panel
        const enCarrito = carrito.find(x => x.prod_id == p.prod_id && !x.esMinimo);
        if (enCarrito) {
            if (enCarrito.cantidad >= p.stock) return toast("Stock insuficiente", "warning");
            enCarrito.cantidad += 1;
            renderCarrito();
            document.getElementById("buscar").value = "";
            document.getElementById("resultados").innerHTML = "";
            toast(`+1 ${p.nombre} (×${enCarrito.cantidad})`, "success");
            return;
        }
        // No está en carrito → mostrar panel para elegir cantidad (Enter o botón lo agrega)
        document.getElementById("buscar").value = p.nombre;
        prepararVenta(p.prod_id);
        toast(`${p.nombre} — confirma cantidad`, "info");
        return;
    } else {
        if (fuente === "cámara") {
            document.getElementById("escanerEstado").textContent = `Código: ${codigo} — no encontrado`;
            setTimeout(() => {
                if (_escanerActivo)
                    document.getElementById("escanerEstado").textContent = "Apunta al código de barras";
            }, 2000);
        } else {
            document.getElementById("buscar").value = codigo;
            buscarProducto();
            toast(`Código ${codigo} no encontrado en inventario`, "warning");
        }
    }
}

// ── Escáner de cámara: abrir ──
async function abrirEscaner(contexto) {
    _escanerContexto = contexto || "ventas";
    const titulos = { ventas: "Escanear producto", inventario: "Escanear ID de producto", reabastecer: "Escanear producto a reabastecer" };
    const tituloEl = document.getElementById("escanerTitulo");
    if (tituloEl) tituloEl.textContent = "📷 " + (titulos[_escanerContexto] || "Escanear código");

    const modal = document.getElementById("modalEscaner");
    modal.classList.add("active");
    modal.style.display = "flex";

    const video    = document.getElementById("escanerVideo");
    const estadoEl = document.getElementById("escanerEstado");

    try {
        _escanerStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } }
        });
        video.srcObject = _escanerStream;
        _escanerActivo  = true;
        estadoEl.textContent = "Apunta al código de barras";

        // Usar BarcodeDetector si está disponible (Chrome Android, Edge)
        if ("BarcodeDetector" in window) {
            _iniciarBarcodeDetector(video, estadoEl);
        } else {
            // Fallback: capturar frames en canvas y usar ZXing-wasm (cargado bajo demanda)
            await _iniciarZXingFallback(video, estadoEl);
        }
    } catch (err) {
        estadoEl.textContent = "No se pudo acceder a la cámara";
        console.warn("[Escaner]", err);
        setTimeout(cerrarEscaner, 2500);
    }
}

// ── BarcodeDetector nativo ──
function _iniciarBarcodeDetector(video, estadoEl) {
    const detector = new BarcodeDetector({
        formats: ["ean_13","ean_8","code_128","code_39","qr_code","upc_a","upc_e","itf","codabar"]
    });
    let procesando = false;
    _escanerTimer = setInterval(async () => {
        if (!_escanerActivo || procesando || video.readyState < 2) return;
        procesando = true;
        try {
            const barcodes = await detector.detect(video);
            if (barcodes.length > 0) {
                const codigo = barcodes[0].rawValue;
                _escanerActivo = false;
                clearInterval(_escanerTimer);
                estadoEl.textContent = `✅ Código: ${codigo}`;
                setTimeout(() => _onCodigoLeido(codigo, "cámara"), 400);
            }
        } catch(_) {}
        procesando = false;
    }, 250);
}

// ── Fallback con ZXing (cargado dinámicamente) ──
async function _iniciarZXingFallback(video, estadoEl) {
    estadoEl.textContent = "Cargando motor de escaneo...";
    try {
        await _cargarScript("https://cdn.jsdelivr.net/npm/@zxing/library@0.21.0/umd/index.min.js");
        const codeReader = new ZXing.BrowserMultiFormatReader();
        estadoEl.textContent = "Apunta al código de barras";
        codeReader.decodeFromVideoElement(video, (result, err) => {
            if (!_escanerActivo) return;
            if (result) {
                _escanerActivo = false;
                codeReader.reset();
                estadoEl.textContent = `✅ Código: ${result.text}`;
                setTimeout(() => _onCodigoLeido(result.text, "cámara"), 400);
            }
        });
        // Guardar referencia para cerrar
        window._zxingReader = codeReader;
    } catch(e) {
        estadoEl.textContent = "Motor no disponible. Usa el lector físico.";
        console.warn("[ZXing fallback]", e);
    }
}

// ── Cerrar escáner ──
function cerrarEscaner() {
    _escanerActivo = false;
    clearInterval(_escanerTimer);
    _escanerTimer = null;

    if (_escanerStream) {
        _escanerStream.getTracks().forEach(t => t.stop());
        _escanerStream = null;
    }
    if (window._zxingReader) {
        try { window._zxingReader.reset(); } catch(_) {}
        window._zxingReader = null;
    }

    const video = document.getElementById("escanerVideo");
    if (video) video.srcObject = null;

    const modal = document.getElementById("modalEscaner");
    if (modal) { modal.classList.remove("active"); modal.style.display = "none"; }
}

// ── Helper: cargar script externo una vez ──
function _cargarScript(src) {
    return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
        const s = document.createElement("script");
        s.src = src; s.onload = resolve; s.onerror = reject;
        document.head.appendChild(s);
    });
}

// =============================================
// VENTAS
// =============================================
function buscarProducto() {
    let b = document.getElementById("buscar").value.toLowerCase().trim();
    let res = document.getElementById("resultados");
    res.innerHTML = "";
    if (b === "") return;
    inventario.filter(p => p.nombre.toLowerCase().includes(b) || p.prod_id?.toString().includes(b))
        .forEach(p => {
            res.innerHTML += `<div onclick="prepararVenta('${p.prod_id}')" tabindex="0" style="cursor:pointer;padding:8px;border-bottom:1px solid #e2e8f0;outline:none;" onkeydown="if(event.key==='Enter'){prepararVenta('${p.prod_id}')}">${p.nombre} — ${formatter.format(p.precio)}</div>`;
        });
}

function prepararVenta(prod_id) {
    let p = inventario.find(x => x.prod_id == prod_id);

    // Si el producto ya está en el carrito (escaneado de nuevo), sumar 1 directo
    const enCarrito = carrito.find(x => x.prod_id == prod_id && !x.esMinimo);
    if (enCarrito) {
        if (enCarrito.cantidad >= p.stock) return toast("Stock insuficiente", "warning");
        enCarrito.cantidad += 1;
        renderCarrito();
        document.getElementById("buscar").value = "";
        document.getElementById("resultados").innerHTML = "";
        toast(`+1 ${p.nombre} (×${enCarrito.cantidad})`, "success");
        return;
    }

    let minBtn = p.precio_min
        ? `<button onclick="usarPrecioMin('${p.prod_id}')" style="margin-left:8px;background:#f59e0b;color:white;padding:4px 10px;border-radius:6px;font-size:0.85rem;">MIN</button>`
        : "";
    const stockAlerta = p.stock <= 3
        ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:8px;padding:6px 10px;margin-bottom:8px;font-size:0.85rem;color:#92400e;">
            ⚠️ <b>Stock bajo:</b> solo quedan ${p.stock} unidades
           </div>`
        : "";
    document.getElementById("resultados").innerHTML = `
        <div style="background:#f8fafc;padding:12px;border-radius:8px;">
            ${stockAlerta}
            <strong>${p.nombre}</strong><br>
            Precio: ${formatter.format(p.precio)} ${minBtn}<br>
            ${p.precio_min ? `<small style="color:#64748b;">Precio mínimo: ${formatter.format(p.precio_min)}</small><br>` : ""}
            Stock disponible: <b>${p.stock}</b><br><br>
            <input id="cantActual" type="number" inputmode="numeric" value="1" min="1" style="width:80px;margin-bottom:0;" onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('btnAnadirCarrito')?.click();}">
            <button id="btnAnadirCarrito" onclick="agregarCarrito('${p.prod_id}')" style="margin-left:8px;">Añadir al carrito</button>
        </div>`;
    // Enfocar el campo de cantidad — intentar varias veces para Edge PWA que es más lento
    [50, 150, 300].forEach(ms => setTimeout(() => {
        const c = document.getElementById("cantActual");
        if (c && document.activeElement?.id !== "cantActual") { c.focus(); c.select(); }
    }, ms));
}

function usarPrecioMin(prod_id) {
    let p = inventario.find(x => x.prod_id == prod_id);
    if (!p || !p.precio_min) return;
    let c = parseInt(document.getElementById("cantActual")?.value || 1);
    if (c > p.stock) return toast("Stock insuficiente", "warning");
    // Si ya está en el carrito, sumar cantidad
    const existe = carrito.find(x => x.prod_id == prod_id && x.esMinimo);
    if (existe) { existe.cantidad += c; }
    else { carrito.push({ ...p, precio: p.precio_min, cantidad: c, esMinimo: true }); }
    renderCarrito();
    document.getElementById("buscar").value = "";
    document.getElementById("resultados").innerHTML = "";
}

function agregarCarrito(prod_id) {
    let p = inventario.find(x => x.prod_id == prod_id);
    let c = parseInt(document.getElementById("cantActual").value) || 1;
    if (c > p.stock) return toast("Stock insuficiente", "warning");
    // Si ya está en el carrito, sumar cantidad
    const existe = carrito.find(x => x.prod_id == prod_id && !x.esMinimo);
    if (existe) { existe.cantidad += c; }
    else { carrito.push({ ...p, cantidad: c, esMinimo: false }); }
    renderCarrito();
    document.getElementById("buscar").value = "";
    document.getElementById("resultados").innerHTML = "";
}

function cambiarCantidadCarrito(i, delta) {
    if (!carrito[i]) return;
    const nueva = carrito[i].cantidad + delta;
    if (nueva <= 0) { carrito.splice(i, 1); }
    else { carrito[i].cantidad = nueva; }
    renderCarrito();
}

function renderCarrito() {
    let total = 0;
    const cont = document.getElementById("carrito");
    cont.innerHTML = "";
    if (carrito.length === 0) {
        cont.innerHTML = `<li style="list-style:none;color:#94a3b8;text-align:center;padding:16px 0;font-size:0.9rem;">Carrito vacío</li>`;
        document.getElementById("total").innerText = formatter.format(0);
        resetTipoPago();
        return;
    }
    carrito.forEach((p, i) => {
        total += p.precio * p.cantidad;
        cont.innerHTML += `
        <li style="list-style:none;display:flex;align-items:center;gap:8px;padding:8px 10px;background:#f8fafc;border-radius:10px;margin-bottom:6px;">
            <div style="flex:1;min-width:0;">
                <div style="font-size:0.88rem;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}${p.esMinimo ? ' <span style="color:#f59e0b;font-size:0.75rem;font-weight:400;">(mín)</span>' : ''}</div>
                <div style="font-size:0.82rem;color:#16a34a;font-weight:700;margin-top:2px;">${formatter.format(p.precio * p.cantidad)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:4px;flex-shrink:0;">
                <button onclick="cambiarCantidadCarrito(${i},-1)" style="width:26px;height:26px;border-radius:50%;background:#e2e8f0;border:none;cursor:pointer;font-size:1rem;font-weight:700;color:#334155;display:flex;align-items:center;justify-content:center;">−</button>
                <span style="min-width:22px;text-align:center;font-size:0.88rem;font-weight:600;color:#1e293b;">${p.cantidad}</span>
                <button onclick="cambiarCantidadCarrito(${i},1)" style="width:26px;height:26px;border-radius:50%;background:#e2e8f0;border:none;cursor:pointer;font-size:1rem;font-weight:700;color:#334155;display:flex;align-items:center;justify-content:center;">+</button>
                <button onclick="quitarCarrito(${i})" style="width:26px;height:26px;border-radius:50%;background:#fee2e2;border:none;cursor:pointer;font-size:0.85rem;color:#dc2626;margin-left:2px;display:flex;align-items:center;justify-content:center;">✕</button>
            </div>
        </li>`;
    });
    document.getElementById("total").innerText = formatter.format(total);
}

function quitarCarrito(i) { carrito.splice(i, 1); renderCarrito(); }

function calcularVueltoEnVivo() {
    const total = carrito.reduce((acc, p) => acc + p.precio * p.cantidad, 0);
    const pago  = parsearMonto(document.getElementById("pago").value);
    document.getElementById("vueltos").innerText = pago >= total ? formatter.format(pago - total) : "$ 0";
}

// =============================================
// PAGOS — WOMPI
// =============================================
async function generarLinkWompi(totalCOP) {
    // 💡 Apuntamos a la Edge Function "dynamic-responder" de tu panel
    const FUNC_URL = "https://fpyvifloppztkuewgmvl.supabase.co/functions/v1/dynamic-responder";
    const empresa  = usuarioActivo?.empresa || "Mi Empresa";
    const amountCents = Math.round(totalCOP) * 100;

    // Obtener la wompi_key que el comercio guardó en su perfil
    const wompiKey = usuarioActivo?.wompi_key;
    if (!wompiKey) {
        throw new Error("Por favor configura tu llave de Wompi en tu perfil antes de cobrar.");
    }

    const resp = await fetch(FUNC_URL, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json" 
        },
        body: JSON.stringify({
            amount_in_cents: amountCents,
            description: `Pago ${empresa} — ${new Date().toLocaleDateString("es-CO")}`,
            name: empresa,
            wompi_key: wompiKey // Enviamos la llave del comercio
        }),
    });

    if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        throw new Error(errorData.error || "No se pudo generar el link de pago.");
    }

    const { url } = await resp.json();
    return url;
}

function elegirTipoPago(tipo) {
    if (carrito.length === 0) return toast("El carrito está vacío.", "warning");
    const selector = document.getElementById("tipoPagoSelector");
    const panelEfectivo = document.getElementById("panelEfectivo");
    if (tipo === "efectivo") {
        if (selector) selector.style.display = "none";
        if (panelEfectivo) panelEfectivo.style.display = "block";
        setTimeout(() => document.getElementById("pago")?.focus(), 50);
    } else {
        abrirModalMetodoPago();
    }
}

function resetTipoPago() {
    const selector = document.getElementById("tipoPagoSelector");
    const panelEfectivo = document.getElementById("panelEfectivo");
    if (selector) selector.style.display = "flex";
    if (panelEfectivo) panelEfectivo.style.display = "none";
    const pagoInput = document.getElementById("pago");
    if (pagoInput) pagoInput.value = "";
    const vueltos = document.getElementById("vueltos");
    if (vueltos) vueltos.innerText = "$ 0";
}

function abrirModalMetodoPago_efectivo() {
    seleccionarMetodoPago("efectivo");
}

function abrirModalMetodoPago() {
    if (carrito.length === 0) return toast("El carrito está vacío.", "warning");
    const total = carrito.reduce((s, p) => s + p.precio * p.cantidad, 0);
    document.getElementById("metodoPagoTotal").textContent = formatter.format(total);

    // Renderizar botones de métodos personalizados (Nequi, Daviplata, etc.)
    const contenedor = document.getElementById("botonesMetodosPersonalizados");
    if (contenedor) {
        if (metodosPagoPersonalizados.length > 0) {
            contenedor.innerHTML = metodosPagoPersonalizados.map(m => `
                <button onclick="cerrarModalMetodoPago();mostrarDetalleMetodoPago('${m.id}')"
                    style="display:flex;align-items:center;gap:10px;width:100%;padding:14px 16px;border:1px solid #e2e8f0;border-radius:10px;background:#fff;cursor:pointer;font-size:0.95rem;font-weight:500;margin-bottom:8px;color:#1e293b;">
                    <span>${_etiquetaMetodo(m.tipo)}${m.nombre_comercial ? ' — ' + m.nombre_comercial : ''}</span>
                </button>
            `).join("");
            contenedor.style.display = "block";
        } else {
            contenedor.innerHTML = "";
            contenedor.style.display = "none";
        }
    }

    // Mostrar/ocultar botón Wompi según si el dueño tiene key configurada
    const btnWompi = document.getElementById("btnMetodoWompi");
    if (btnWompi) {
        const duenId = usuarioActivo?.es_sub ? usuarioActivo.dueno_id : usuarioActivo?.id;
        // Para sub-usuarios, revisar wompi_key del dueño no disponible aquí; siempre mostrar si fue configurada
        btnWompi.style.display = usuarioActivo?.wompi_key ? "flex" : "none";
    }

    document.getElementById("modalMetodoPago").classList.add("active");
    document.getElementById("modalMetodoPago").classList.remove("oculto");
}

function cerrarModalMetodoPago() {
    const m = document.getElementById("modalMetodoPago");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

async function seleccionarMetodoPago(metodo) {
    cerrarModalMetodoPago();
    if (metodo === "efectivo") {
        await finalizarVenta("efectivo");
    } else if (metodo === "wompi") {
        const total = carrito.reduce((s, p) => s + p.precio * p.cantidad, 0);
        toast("Generando link de pago...", "info");
        try {
            const url = await generarLinkWompi(total);
            // Abrir checkout Wompi en nueva pestaña
            window._wompiLinkActual = url;
            window._wompiTotal = total;
            // Mostrar modal con link + opción WhatsApp
            document.getElementById("wompiLinkURL").textContent = url;
            document.getElementById("wompiLinkURL").href = url;
            document.getElementById("modalWompiLink").classList.add("active");
            document.getElementById("modalWompiLink").classList.remove("oculto");
        } catch (err) {
            toast("Error generando link: " + err.message, "error");
        }
    }
}

function cerrarModalWompiLink() {
    const m = document.getElementById("modalWompiLink");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

function abrirWompiLink() {
    if (window._wompiLinkActual) window.open(window._wompiLinkActual, "_blank");
}

function copiarLinkWompi() {
    const url = window._wompiLinkActual;
    if (!url) return;
    const empresa = usuarioActivo?.empresa || "Mi Empresa";
    const total = formatter.format(window._wompiTotal || 0);
    const mensaje = `Hola! Aquí está tu link de pago de ${empresa} por ${total}:\n${url}`;
    navigator.clipboard.writeText(mensaje).then(() => {
        const btn = document.getElementById("btnCopiarWompi");
        if (btn) { btn.textContent = "✅ Copiado"; setTimeout(() => { btn.textContent = "📋 Copiar"; }, 2000); }
    }).catch(() => {
        // Fallback para navegadores sin clipboard API
        const ta = document.createElement("textarea");
        ta.value = mensaje;
        ta.style.cssText = "position:fixed;top:-9999px;";
        document.body.appendChild(ta); ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        const btn = document.getElementById("btnCopiarWompi");
        if (btn) { btn.textContent = "✅ Copiado"; setTimeout(() => { btn.textContent = "📋 Copiar"; }, 2000); }
    });
}
async function wompiPagoConfirmado() {
    cerrarModalWompiLink();
    await finalizarVenta("wompi");
}

async function finalizarVenta(metodoPago = "efectivo") {
    if (carrito.length === 0) return toast("El carrito está vacío.", "warning");
    window._metodoPagoActual = metodoPago;
    // Limpiar garantías anteriores completamente
    window._ultimaVentaGarantia = null;
    window._ventaGarantiaActual = undefined;
    // Verificar si hay productos con garantía usando inventario
    const productosConGarantia = carrito.filter(p => {
        const inv = inventario.find(x => x.prod_id == p.prod_id);
        return inv?.tiene_garantia;
    });
    if (productosConGarantia.length > 0) {
        // Mostrar modal para capturar datos del comprador
        document.getElementById("garantiaNombre").value = "";
        document.getElementById("garantiaId").value     = "";
        document.getElementById("garantiaError").textContent = "";
        document.getElementById("modalGarantia").classList.add("active");
        document.getElementById("modalGarantia").classList.remove("oculto");
        return; // esperar confirmación del modal
    }
    await procesarVenta(null, null);
}

function cerrarModalGarantia() {
    const m = document.getElementById("modalGarantia");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

async function confirmarGarantiaYVenta() {
    const nombre = document.getElementById("garantiaNombre").value.trim();
    const idCliente = document.getElementById("garantiaId").value.trim();
    const errEl = document.getElementById("garantiaError");
    if (!nombre || !idCliente) { errEl.textContent = "Completa nombre e identificación."; return; }
    cerrarModalGarantia();
    await procesarVenta(nombre, idCliente);
}

function generarCodigoGarantia() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    // Abreviatura: primeras letras de cada palabra de la empresa (máx 4)
    const empresa = (usuarioActivo?.empresa || "GAR").toUpperCase();
    const palabras = empresa.trim().split(/\s+/);
    let abrev = palabras.map(p => p[0]).join("").slice(0, 4);
    if (abrev.length < 2) abrev = empresa.slice(0, 4).replace(/\s/g, "");
    // Código aleatorio
    let random = "";
    for (let i = 0; i < 8; i++) random += chars[Math.floor(Math.random() * chars.length)];
    return abrev + "-" + random;
}
async function procesarVenta(clienteNombre, clienteIdDoc) {
    // Snapshot enriquecido con datos de garantía ANTES de cualquier cambio
    const carritoSnapshot = carrito.map(p => {
        const invProd = inventario.find(x => x.prod_id == p.prod_id);
        return {
            ...p,
            tiene_garantia: invProd?.tiene_garantia || false,
            dias_garantia:  invProd?.dias_garantia  || 0
        };
    });

    const total    = carritoSnapshot.reduce((acc, p) => acc + p.precio * p.cantidad, 0);
    const cantProd = carritoSnapshot.reduce((acc, p) => acc + p.cantidad, 0);

    // Insertar venta
    const ventaData = { total, cant_productos: cantProd, metodo_pago: window._metodoPagoActual || "efectivo" };
    if (usuarioActivo.es_sub) ventaData.sub_usuario_id = usuarioActivo.id;
    else ventaData.usuario_id = usuarioActivo.id;

    const { data: venta, error } = await sb.from("ventas").insert(ventaData).select().single();
    if (error) return toast("Error al registrar la venta.", "error");

    // Insertar items
    const items = carrito.map(p => ({
        venta_id: venta.id,
        prod_id:  p.prod_id,
        nombre:   p.nombre,
        cantidad: p.cantidad,
        precio:   p.precio,
        es_minimo: p.esMinimo || false
    }));
    await sb.from("venta_items").insert(items);

    // Actualizar stock en Supabase
    for (const c of carrito) {
        const prod = inventario.find(x => x.prod_id == c.prod_id);
        if (prod) {
            const nuevoStock = prod.stock - c.cantidad;
            await sb.from("inventario").update({ stock: nuevoStock }).eq("id", prod.id);
            prod.stock = nuevoStock;
        }
    }
    await cargarInventario();

    // Actualizar caja
    saldoActual += total;
    await sb.from("caja").update({ saldo_actual: saldoActual }).eq("id", cajaId);

    // ── Registrar garantías ──
    const garantiasRegistradas = [];
    if (clienteNombre && clienteIdDoc) {
        const productosConGar = carritoSnapshot.filter(p => p.tiene_garantia && p.dias_garantia > 0);
        for (const prod of productosConGar) {
            const fechaVenc = new Date();
            fechaVenc.setDate(fechaVenc.getDate() + prod.dias_garantia);
            const codigo = generarCodigoGarantia();
            const garantiaData = {
                venta_id:          venta.id,
                producto_nombre:   prod.nombre,
                prod_id:           prod.prod_id,
                cliente_nombre:    clienteNombre,
                cliente_id:        clienteIdDoc,
                codigo_garantia:   codigo,
                fecha_vencimiento: fechaVenc.toISOString()
            };
            if (usuarioActivo.es_sub) garantiaData.sub_usuario_id = usuarioActivo.id;
            else garantiaData.usuario_id = usuarioActivo.id;
            const { data: garRow, error: garErr } = await sb.from("registros_garantia").insert(garantiaData).select().single();
            if (!garErr && garRow) garantiasRegistradas.push(garRow);

        }
    }
    // Guardar para el recibo
    window._ultimaVentaGarantia = (clienteNombre && clienteIdDoc)
        ? { clienteNombre, clienteIdDoc, garantias: garantiasRegistradas }
        : null;

    carrito = [];
    document.getElementById("carrito").innerHTML = "";
    document.getElementById("total").innerText   = "$ 0";
    document.getElementById("pago").value        = "";
    document.getElementById("vueltos").innerText = "$ 0";
    document.getElementById("buscar").value      = "";
    document.getElementById("resultados").innerHTML = "";

    await cargarHistorial();
    renderInventario();
    actualizarPanelCaja();
    filtrarHistorial();
    await cargarListaGarantias();
    // Guardar índice de la última venta para imprimir
    // Guardar la venta directamente desde carritoSnapshot (no del historial)
    window._ultimaVentaData = {
        id:    venta.id,
        fecha: new Date(venta.fecha).toLocaleString(),
        total: total,
        cantProd: cantProd,
        items: carritoSnapshot.map(p => ({
            nombre:   p.nombre,
            cantidad: p.cantidad,
            precio:   p.precio,
            esMinimo: p.esMinimo || false
        }))
    };
    mostrarModalVentaExitosa();
}

function mostrarModalVentaExitosa() {
    const m = document.getElementById("modalVentaExitosa");
    m.classList.add("active");
    m.classList.remove("oculto");
}

function cerrarModalVentaExitosa() {
    const m = document.getElementById("modalVentaExitosa");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
    toast("Venta registrada exitosamente.", "success");
}

function imprimirDesdeVenta() {
    cerrarModalVentaExitosa();
    if (!window._ultimaVentaData) { console.error("[RECIBO] _ultimaVentaData es null"); return; }
    const g = window._ultimaVentaGarantia;
    window._ventaGarantiaActual = g ? {
        clienteNombre: g.clienteNombre,
        clienteIdDoc:  g.clienteIdDoc,
        garantias:     g.garantias || []
    } : null;
    mostrarReciboDirecto(window._ultimaVentaData);
}

async function mostrarReciboDirecto(v) {
    const empresa = usuarioActivo?.empresa || "Mi Empresa";
    const nombre  = `${usuarioActivo?.nombre || ""} ${usuarioActivo?.apellido || ""}`.trim();
    let itemsHTML = v.items.map(p => {
        const precio   = parseFloat(p.precio) || 0;
        const cantidad = parseInt(p.cantidad) || 0;
        return `<tr>
            <td style="word-break:break-word;overflow-wrap:break-word;padding:5px 3px;font-size:0.82rem;vertical-align:top;">${p.nombre}</td>
            <td style="width:28px;text-align:center;padding:5px 2px;font-size:0.82rem;vertical-align:top;white-space:nowrap;">${cantidad}</td>
            <td style="width:90px;text-align:right;padding:5px 3px;font-size:0.78rem;vertical-align:top;white-space:nowrap;">${formatter.format(precio)}</td>
        </tr>`;
    }).join("");
    const contenido = `
        <div id="reciboImprimible" style="font-family:'Courier New',monospace;color:#000;width:100%;">
            <div style="text-align:center;border-bottom:2px dashed #000;padding-bottom:12px;margin-bottom:14px;">
                <div style="font-size:1.3rem;font-weight:700;letter-spacing:0.05em;">${empresa}</div>
                <div style="font-size:0.82rem;margin-top:2px;">${nombre}</div>
                <div style="font-size:0.75rem;color:#555;margin-top:4px;">${v.fecha}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="border-bottom:1px dashed #000;">
                    <th style="text-align:left;padding:4px 3px;font-size:0.82rem;">Producto</th>
                    <th style="width:28px;text-align:center;padding:4px 2px;font-size:0.82rem;">Cant</th>
                    <th style="width:90px;text-align:right;padding:4px 3px;font-size:0.78rem;">Precio</th>
                </tr></thead>
                <tbody>${itemsHTML}</tbody>
            </table>
            <div style="border-top:2px dashed #000;margin-top:12px;padding-top:10px;text-align:right;">
                <strong style="font-size:1rem;">TOTAL: ${formatter.format(v.total)}</strong>
            </div>
            ${buildGarantiaHTML()}
            <div style="border-top:1px dashed #000;margin-top:14px;padding-top:10px;text-align:center;font-size:0.75rem;color:#555;line-height:1.6;">
                ¡Gracias por su compra!<br>Billing System
            </div>
        </div>`;
    const modal = document.getElementById("modalRecibo");
    document.getElementById("reciboContenido").innerHTML = `
        <h2 class="auth-heading" style="margin-bottom:1rem;">Recibo de venta</h2>
        ${contenido}
        <div style="display:flex;gap:0.6rem;margin-top:1.5rem;flex-wrap:wrap;">
            <button class="auth-btn" style="flex:1;min-width:120px;" onclick="imprimirReciboWeb()">🖨️ Imprimir</button>
            <button class="auth-btn" style="flex:1;min-width:120px;background:#16a34a;" onclick="guardarReciboPDF()">⬇️ Guardar PDF</button>
            <button class="auth-btn" style="flex:1;min-width:120px;background:#334155;" onclick="volverAVentas()">🏪 Ventas</button>
        </div>`;
    window._pdfVentaData = v;
    modal.classList.add("active");
    modal.classList.remove("oculto");
}

function cerrarModalRecibo() {
    const m = document.getElementById("modalRecibo");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
    // Resetear para que próxima apertura cargue desde Supabase
    window._ventaGarantiaActual = undefined;
}

// =============================================
// INVENTARIO
// =============================================
const INV_PAGE = 8; // cuántos mostrar inicialmente
let _invMostrados = INV_PAGE;
let _invFiltro = "";

function _cardInventario(p, i) {
    const stockColor = p.stock === 0 ? "#ef4444" : p.stock <= 3 ? "#f59e0b" : "#16a34a";
    const stockLabel = p.stock === 0 ? "Agotado" : p.stock <= 3 ? `⚠️ ${p.stock}` : p.stock;
    const garStr = p.tiene_garantia
        ? `<span style="background:#dcfce7;color:#15803d;border-radius:6px;padding:2px 7px;font-size:0.72rem;font-weight:600;">${p.dias_garantia}d garantía</span>`
        : "";
    const minStr = p.precio_min
        ? `<span style="font-size:0.75rem;color:#94a3b8;">Mín: ${formatter.format(p.precio_min)}</span>`
        : "";
    return `
    <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px;">
        <div style="flex:1;min-width:0;">
            <div style="font-size:0.68rem;font-weight:600;color:#94a3b8;letter-spacing:0.04em;margin-bottom:2px;text-transform:uppercase;">${p.prod_id}</div>
            <div style="font-size:0.88rem;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${p.nombre}</div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:3px;flex-wrap:wrap;">
                <span style="font-size:0.82rem;font-weight:700;color:#1e293b;">${formatter.format(p.precio)}</span>
                ${minStr}
                ${garStr}
            </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
            <span style="background:${stockColor}1a;color:${stockColor};border-radius:8px;padding:3px 10px;font-size:0.78rem;font-weight:700;">${stockLabel}</span>
            <div style="display:flex;gap:4px;">
                <button onclick="abrirModalEditar(${i})" title="Editar"
                    style="height:28px;padding:0 8px;border-radius:8px;background:#eff6ff;border:1px solid #bfdbfe;cursor:pointer;font-size:0.72rem;font-weight:600;color:#2563eb;display:flex;align-items:center;gap:4px;letter-spacing:0.01em;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                    Editar
                </button>
                <button onclick="eliminar(${i})" title="Eliminar"
                    style="height:28px;padding:0 8px;border-radius:8px;background:#fef2f2;border:1px solid #fecaca;cursor:pointer;font-size:0.72rem;font-weight:600;color:#dc2626;display:flex;align-items:center;gap:4px;letter-spacing:0.01em;">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                    Eliminar
                </button>
            </div>
        </div>
    </div>`;
}

function renderInventario() {
    _invMostrados = INV_PAGE;
    _renderInventarioFiltrado();
}

function filtrarInventario() {
    _invFiltro = (document.getElementById("buscarInventario")?.value || "").toLowerCase();
    _invMostrados = INV_PAGE;
    _renderInventarioFiltrado();
}

function mostrarMasInventario() {
    _invMostrados += INV_PAGE;
    _renderInventarioFiltrado();
}

function _renderInventarioFiltrado() {
    const tabla = document.getElementById("tablaInventario");
    if (!tabla) return;

    const filtrados = _invFiltro
        ? inventario.filter(p =>
            p.nombre?.toLowerCase().includes(_invFiltro) ||
            String(p.prod_id).includes(_invFiltro))
        : inventario;

    const visibles = filtrados.slice(0, _invMostrados);
    tabla.innerHTML = visibles.map((p, i) => {
        const idxReal = inventario.indexOf(p);
        return _cardInventario(p, idxReal);
    }).join("");

    // Contador
    const contador = document.getElementById("invContador");
    if (contador) contador.textContent = `${filtrados.length} producto${filtrados.length !== 1 ? "s" : ""}`;

    // Botón ver más
    const showMore = document.getElementById("invShowMore");
    if (showMore) showMore.style.display = filtrados.length > _invMostrados ? "block" : "none";
}

async function agregarProducto() {
    const precio    = parsearMonto(document.getElementById("precio").value);
    const precioMin = parsearMonto(document.getElementById("precioMin").value);
    const tieneGarantia = document.getElementById("tieneGarantia").checked;
    const diasGarantia  = tieneGarantia ? parseInt(document.getElementById("diasGarantia").value) || 0 : 0;
    let insertData = {
        prod_id:        document.getElementById("id").value.trim(),
        nombre:         document.getElementById("nombre").value.trim(),
        stock:          parseInt(document.getElementById("stock").value),
        precio,
        precio_min:     precioMin || null,
        tiene_garantia: tieneGarantia,
        dias_garantia:  diasGarantia
    };
    if (usuarioActivo.es_sub && usuarioActivo.compartir_inv) {
        // Sub con compartir → guarda bajo el dueño, visible para ambos
        insertData.dueno_id = usuarioActivo.dueno_id;
        insertData.sub_id   = null;
    } else if (usuarioActivo.es_sub && !usuarioActivo.compartir_inv) {
        // Sub sin compartir → inventario propio, no visible para el dueño ni otros subs
        insertData.dueno_id = usuarioActivo.dueno_id;
        insertData.sub_id   = usuarioActivo.id;
    } else {
        // Dueño → su propio inventario
        insertData.dueno_id = usuarioActivo.id;
        insertData.sub_id   = null;
    }
    const { data, error } = await sb.from("inventario").insert(insertData).select().single();
    if (error) return toast("Error al guardar producto.", "error");
    inventario.push(data);
    renderInventario();
    ["id","nombre","stock","precio","precioMin","diasGarantia"].forEach(id => document.getElementById(id).value = "");
    document.getElementById("tieneGarantia").checked = false;
    document.getElementById("diasGarantiaGroup").style.display = "none";
    toast("Producto guardado.", "success");
}

async function ejecutarReabastecimiento() {
    const prod_id = document.getElementById("reabastecerID").value;
    const cant    = parseInt(document.getElementById("reabastecerCant").value);
    const p       = inventario.find(x => x.prod_id == prod_id);
    if (p && !isNaN(cant)) {
        const nuevoStock = p.stock + cant;
        await sb.from("inventario").update({ stock: nuevoStock }).eq("id", p.id);
        p.stock = nuevoStock;
        renderInventario();
        document.getElementById("reabastecerID").value   = "";
        document.getElementById("reabastecerCant").value = "";
        toast("Stock actualizado.", "success");
    }
}

// =============================================
// IMPORTAR INVENTARIO (Excel / CSV)
// =============================================

function abrirImportarInventario() {
    document.getElementById("modalImportarInv").classList.add("active");
    document.getElementById("importarResultado").innerHTML = "";
    const fi = document.getElementById("importarFileInput"); if (fi) fi.value = "";
}

function cerrarImportarInventario() {
    document.getElementById("modalImportarInv").classList.remove("active");
}

function importarArchivoSeleccionado(input) {
    const file = input.files[0]; if (!file) return;
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "csv") {
        const reader = new FileReader();
        reader.onload = e => _procesarCSV(e.target.result);
        reader.readAsText(file, "UTF-8");
    } else if (ext === "xlsx" || ext === "xls") {
        const reader = new FileReader();
        reader.onload = e => _procesarExcel(e.target.result);
        reader.readAsArrayBuffer(file);
    } else {
        toast("Solo se aceptan .xlsx, .xls o .csv", "error");
    }
}

function _parsearFilas(filas) {
    if (filas.length < 2) return { ok: [], errores: ["El archivo está vacío o solo tiene encabezados."] };
    const enc = filas[0].map(h => String(h || "").trim().toLowerCase());
    const col = nombre => {
        const s = { id:["id","cod","codigo","código","ref","referencia","sku"], nombre:["nombre","producto","descripcion","descripción","name"], stock:["stock","cantidad","cant","qty","existencia","existencias"], precio:["precio","price","valor","pvp"], precio_min:["precio_min","preciomin","precio minimo","precio mínimo","min","minimo","mínimo"] };
        return enc.findIndex(h => (s[nombre]||[nombre]).includes(h));
    };
    const iId=col("id"), iNom=col("nombre"), iStk=col("stock"), iPrc=col("precio"), iPMin=col("precio_min");
    if (iNom===-1||iPrc===-1) return { ok:[], errores:["Columnas requeridas: Nombre y Precio. Revisa el archivo."] };
    const ok=[], errores=[];
    filas.slice(1).forEach((fila,fi) => {
        const nombre = String(fila[iNom]||"").trim();
        const precioRaw = parseFloat(String(fila[iPrc]||"0").replace(/[^0-9.]/g,""));
        if (!nombre) { errores.push(`Fila ${fi+2}: nombre vacío, omitida.`); return; }
        if (isNaN(precioRaw)||precioRaw<=0) { errores.push(`Fila ${fi+2}: precio inválido, omitida.`); return; }
        const prod_id = iId>=0&&fila[iId] ? String(fila[iId]).trim() : ("IMP"+Date.now()+fi);
        const stock   = iStk>=0 ? (parseInt(fila[iStk])||0) : 0;
        const pmin    = iPMin>=0 ? (parseFloat(String(fila[iPMin]||"0").replace(/[^0-9.]/g,""))||null) : null;
        ok.push({ prod_id, nombre, stock, precio:precioRaw, precio_min:pmin||null });
    });
    return { ok, errores };
}

function _procesarCSV(texto) {
    const sep = (texto.split(";").length > texto.split(",").length) ? ";" : ",";
    const filas = texto.trim().split(/\r?\n/).map(l => l.split(sep).map(c => c.replace(/^"|"$/g,"").trim()));
    _mostrarVistaPrevia(filas);
}

function _procesarExcel(buffer) {
    const cargar = () => {
        try {
            const wb = XLSX.read(buffer, { type:"array" });
            const ws = wb.Sheets[wb.SheetNames[0]];
            _mostrarVistaPrevia(XLSX.utils.sheet_to_json(ws, { header:1, defval:"" }));
        } catch(e) { toast("Error leyendo Excel: "+e.message, "error"); }
    };
    if (window.XLSX) { cargar(); return; }
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = cargar;
    s.onerror = () => toast("No se pudo cargar el lector de Excel. Usa CSV.", "error");
    document.head.appendChild(s);
}

function _mostrarVistaPrevia(filas) {
    const { ok, errores } = _parsearFilas(filas);
    const res = document.getElementById("importarResultado");
    if (ok.length === 0) { res.innerHTML = `<p style="color:#dc2626;font-size:0.85rem;">${errores.join("<br>")}</p>`; return; }
    window._importarPendiente = ok;
    let html = `<p style="color:#16a34a;font-size:0.85rem;margin-bottom:8px;">✅ ${ok.length} productos listos para importar${errores.length?` · ${errores.length} omitidos`:""}.</p>`;
    if (errores.length) html += `<p style="color:#f59e0b;font-size:0.78rem;margin-bottom:8px;">${errores.join("<br>")}</p>`;
    html += `<div style="max-height:160px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px;">`;
    ok.slice(0,10).forEach(p => {
        html += `<div style="display:flex;justify-content:space-between;padding:5px 8px;border-bottom:1px solid #f1f5f9;font-size:0.78rem;color:#1e293b;background:#fff;">
            <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${p.nombre}</span>
            <span style="margin-left:8px;color:#64748b;">x${p.stock}</span>
            <span style="margin-left:8px;font-weight:600;">${formatter.format(p.precio)}</span></div>`;
    });
    if (ok.length>10) html+=`<div style="padding:5px 8px;color:#64748b;font-size:0.76rem;">… y ${ok.length-10} más</div>`;
    html += `</div><button class="auth-btn" style="width:100%;margin-top:12px;background:#2563eb;" onclick="confirmarImportacion()">⬆️ Importar ${ok.length} productos</button>`;
    res.innerHTML = html;
}

async function confirmarImportacion() {
    const productos = window._importarPendiente;
    if (!productos||!productos.length) return;
    const duenId = usuarioActivo.es_sub ? usuarioActivo.dueno_id : usuarioActivo.id;
    const payload = productos.map(p => ({ ...p, dueno_id:duenId }));
    document.getElementById("importarResultado").innerHTML = `<p style="color:#2563eb;font-size:0.85rem;">Importando ${payload.length} productos…</p>`;
    let importados=0, errCount=0;
    for (let i=0; i<payload.length; i+=50) {
        const lote = payload.slice(i,i+50);
        const { error } = await sb.from("inventario").upsert(lote, { onConflict:"prod_id,dueno_id" });
        if (error) errCount+=lote.length; else importados+=lote.length;
    }
    await cargarInventario(); renderInventario();
    window._importarPendiente = null;
    cerrarImportarInventario();
    toast(`${importados} productos importados${errCount?`, ${errCount} con error`:""}`, importados>0?"success":"error");
}

async function eliminar(i) {
    if (!confirm("¿Eliminar este producto?")) return;
    await sb.from("inventario").delete().eq("id", inventario[i].id);
    inventario.splice(i, 1);
    renderInventario();
}

// --- Modal Editar ---
function abrirModalEditar(i) {
    const p = inventario[i];
    document.getElementById("editIndex").value     = i;
    document.getElementById("editId").value        = p.prod_id;
    document.getElementById("editNombre").value    = p.nombre;
    document.getElementById("editStock").value     = p.stock;
    document.getElementById("editPrecio").value    = new Intl.NumberFormat('es-CO').format(p.precio);
    document.getElementById("editPrecioMin").value = p.precio_min ? new Intl.NumberFormat('es-CO').format(p.precio_min) : "";
    document.getElementById("editTieneGarantia").checked = p.tiene_garantia || false;
    document.getElementById("editDiasGarantia").value    = p.dias_garantia || "";
    document.getElementById("editDiasGarantiaGroup").style.display = p.tiene_garantia ? "block" : "none";
    document.getElementById("editError").textContent = "";
    document.getElementById("modalEditar").classList.add("active");
    document.getElementById("modalEditar").classList.remove("oculto");
}
function cerrarModalEditar() {
    const m = document.getElementById("modalEditar");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}
async function guardarEdicion() {
    const i       = parseInt(document.getElementById("editIndex").value);
    const precio  = parsearMonto(document.getElementById("editPrecio").value);
    const minRaw  = document.getElementById("editPrecioMin").value.trim();
    const precioMin = minRaw ? parsearMonto(minRaw) : null;
    const errEl   = document.getElementById("editError");
    if (!document.getElementById("editId").value || !document.getElementById("editNombre").value || !precio) {
        errEl.textContent = "ID, Nombre y Precio son obligatorios."; return;
    }
    const tieneGar = document.getElementById("editTieneGarantia").checked;
    const diasGar  = tieneGar ? parseInt(document.getElementById("editDiasGarantia").value) || 0 : 0;
    const updates = {
        prod_id:        document.getElementById("editId").value.trim(),
        nombre:         document.getElementById("editNombre").value.trim(),
        stock:          parseInt(document.getElementById("editStock").value),
        precio, precio_min: precioMin,
        tiene_garantia: tieneGar,
        dias_garantia:  diasGar
    };
    await sb.from("inventario").update(updates).eq("id", inventario[i].id);
    inventario[i] = { ...inventario[i], ...updates };
    renderInventario();
    cerrarModalEditar();
    toast("Producto actualizado.", "success");
}

// =============================================
// HISTORIAL
// =============================================
function filtrarHistorial() {
    const lista      = document.getElementById("listaHistorial");
    const texto      = document.getElementById("busquedaHistorial")?.value.toLowerCase() || "";
    const fechaInput = document.getElementById("fechaFiltro")?.value || "";
    if (!lista) return;
    lista.innerHTML = "";
    historial.filter(v => {
        let coincideNombre = texto ? v.items.some(p => p.nombre.toLowerCase().includes(texto)) : true;
        let coincideFecha  = true;
        if (fechaInput) {
            let partes = v.fecha.split(',')[0].split('/');
            let fechaNorm = `${partes[2]}-${partes[1].padStart(2,'0')}-${partes[0].padStart(2,'0')}`;
            coincideFecha = (fechaNorm === fechaInput);
        }
        return coincideNombre && coincideFecha;
    }).forEach((v, idx) => {
        let prods = v.items.map(p => `${p.nombre} x${p.cantidad}`).join(", ");
        lista.innerHTML += `
            <div class="historial-item">
                <div><b>${v.fecha}</b> — Total: <b>${formatter.format(v.total)}</b></div>
                <div style="color:#64748b;font-size:0.88rem;margin:4px 0;">${prods}</div>
                <button onclick="verRecibo(${historial.indexOf(v)})" style="background:#2563eb;color:white;padding:5px 14px;border-radius:6px;font-size:0.85rem;margin-top:6px;">🧾 Ver / Descargar PDF</button>
            </div><hr>`;
    });
}

// =============================================
// RECIBO PDF
// =============================================
function buildGarantiaHTML() {
    const g = window._ventaGarantiaActual;
    if (!g) return '';
    let html = '<div style="border-top:2px dashed #000;margin-top:12px;padding-top:10px;font-size:0.78rem;">';
    html += '<div style="font-weight:700;margin-bottom:6px;">&#128737;&#65039; GARANTIA</div>';
    html += '<div><b>Cliente:</b> ' + g.clienteNombre + '</div>';
    html += '<div><b>ID:</b> ' + g.clienteIdDoc + '</div>';
    if (g.garantias && g.garantias.length > 0) {
        g.garantias.forEach(function(gr) {
            html += '<div style="margin-top:4px;padding-top:4px;border-top:1px dashed #ccc;">';
            html += '<div><b>Producto:</b> ' + gr.producto_nombre + '</div>';
            html += '<div><b>Codigo:</b> ' + gr.codigo_garantia + '</div>';
            html += '<div><b>Vence:</b> ' + new Date(gr.fecha_vencimiento).toLocaleDateString('es-CO') + '</div>';
            html += '</div>';
        });
    }
    html += '</div>';
    return html;
}

async function verRecibo(idx) {
    const v       = historial[idx];
    const empresa = usuarioActivo?.empresa || "Mi Empresa";
    const nombre  = `${usuarioActivo?.nombre || ""} ${usuarioActivo?.apellido || ""}`.trim();

    // Solo cargar desde Supabase si no viene de imprimirDesdeVenta
    // (imprimirDesdeVenta ya setea _ventaGarantiaActual)
    if (window._ventaGarantiaActual === undefined) {
        let garantiasVenta = [];
        if (v.id) {
            const { data: gars } = await sb.from("registros_garantia").select("*").eq("venta_id", v.id);
            garantiasVenta = gars || [];
        }
        if (garantiasVenta.length > 0) {
            window._ventaGarantiaActual = {
                clienteNombre: garantiasVenta[0].cliente_nombre,
                clienteIdDoc:  garantiasVenta[0].cliente_id,
                garantias:     garantiasVenta
            };
        } else {
            window._ventaGarantiaActual = null;
        }
    }
    let itemsHTML = v.items.map(p => {
        const precio   = parseFloat(p.precio) || 0;
        const cantidad = parseInt(p.cantidad) || 0;
        return `<tr>
            <td style="word-break:break-word;overflow-wrap:break-word;padding:5px 3px;font-size:0.82rem;vertical-align:top;">${p.nombre}</td>
            <td style="width:28px;text-align:center;padding:5px 2px;font-size:0.82rem;vertical-align:top;white-space:nowrap;">${cantidad}</td>
            <td style="width:90px;text-align:right;padding:5px 3px;font-size:0.78rem;vertical-align:top;white-space:nowrap;">${formatter.format(precio)}</td>
        </tr>`;
    }).join("");
    const contenido = `
        <div id="reciboImprimible" style="font-family:'Courier New',monospace;color:#000;width:100%;">
            <div style="text-align:center;border-bottom:2px dashed #000;padding-bottom:12px;margin-bottom:14px;">
                <div style="font-size:1.3rem;font-weight:700;letter-spacing:0.05em;">${empresa}</div>
                <div style="font-size:0.82rem;margin-top:2px;">${nombre}</div>
                <div style="font-size:0.75rem;color:#555;margin-top:4px;">${v.fecha}</div>
            </div>
            <table style="width:100%;border-collapse:collapse;">
                <thead><tr style="border-bottom:1px dashed #000;">
                    <th style="text-align:left;padding:4px 3px;font-size:0.82rem;">Producto</th>
                    <th style="width:28px;text-align:center;padding:4px 2px;font-size:0.82rem;">Cant</th>
                    <th style="width:90px;text-align:right;padding:4px 3px;font-size:0.78rem;">Precio</th>
                </tr></thead>
                <tbody>${itemsHTML}</tbody>
            </table>
            <div style="border-top:2px dashed #000;margin-top:12px;padding-top:10px;text-align:right;">
                <strong style="font-size:1rem;">TOTAL: ${formatter.format(v.total)}</strong>
            </div>
            ${buildGarantiaHTML()}
            <div class="recibo-footer" style="border-top:1px dashed #000;margin-top:14px;padding-top:10px;text-align:center;font-size:0.75rem;color:#555;line-height:1.6;">
                ¡Gracias por su compra!<br>Billing System
            </div>
        </div>`;
    const modal = document.getElementById("modalRecibo");
    document.getElementById("reciboContenido").innerHTML = `
        <h2 class="auth-heading" style="margin-bottom:1rem;">Recibo de venta</h2>
        ${contenido}
        <div style="display:flex;gap:0.6rem;margin-top:1.5rem;flex-wrap:wrap;">
            <button class="auth-btn" style="flex:1;min-width:120px;" onclick="imprimirReciboWeb()">🖨️ Imprimir</button>
            <button class="auth-btn" style="flex:1;min-width:120px;background:#16a34a;" onclick="guardarReciboPDF()">⬇️ Guardar PDF</button>
            <button class="auth-btn" style="flex:1;min-width:120px;background:#334155;" onclick="cerrarModalRecibo()">Cerrar</button>
        </div>`;
    window._pdfVentaData = v;
    modal.classList.add("active"); modal.classList.remove("oculto");
}
function volverAVentas() {
    cerrarModalRecibo();
    show("ventas");
}

function _getReciboPageHTML(reciboHTML, showPrintBtn, showSaveBtn) {
    const btns = [];
    if (showPrintBtn) btns.push('<button class="btn-accion btn-print" onclick="window.print();">🖨️ Imprimir</button>');
    if (showSaveBtn)  btns.push('<button class="btn-accion btn-save"  onclick="window.print();">⬇️ Guardar PDF</button>');
    btns.push('<button class="btn-accion btn-back"  onclick="window.close();">✕ Cerrar</button>');
    return '<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Recibo</title><style>' +
    '* { margin: 0; padding: 0; box-sizing: border-box; }' +
    'body { font-family: "Courier New", monospace; background: #f1f5f9; display: flex; flex-direction: column; align-items: center; padding: 20px 16px; }' +
    '.recibo-wrap { width: 302px; background: #fff; border-radius: 8px; padding: 16px 14px; box-shadow: 0 2px 12px rgba(0,0,0,0.1); }' +
    'table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin: 10px 0; table-layout: fixed; }' +
    'thead tr { border-bottom: 1px dashed #000; }' +
    'th { padding: 4px 4px 6px; font-weight: 700; text-align: left; }' +
    'th:nth-child(1) { width: auto; }' +
    'th:nth-child(2) { width: 32px; text-align: center; }' +
    'th:nth-child(3) { width: 72px; text-align: right; }' +
    'td { padding: 5px 4px; vertical-align: top; word-break: break-word; }' +
    'td:nth-child(1) { overflow-wrap: break-word; }' +
    'td:nth-child(2) { text-align: center; white-space: nowrap; width: 32px; }' +
    'td:nth-child(3) { text-align: right; white-space: nowrap; width: 72px; font-size: 0.75rem; }' +
    '.recibo-total { border-top: 2px dashed #000; margin-top: 10px; padding-top: 10px; text-align: right; font-size: 1rem; font-weight: 700; }' +
    '.recibo-garantia { border-top: 2px dashed #000; margin-top: 12px; padding-top: 10px; font-size: 0.78rem; line-height: 1.6; }' +
    '.recibo-garantia-item { border-top: 1px dashed #ccc; margin-top: 6px; padding-top: 6px; }' +
    '.recibo-footer { border-top: 1px dashed #000; margin-top: 14px; padding-top: 10px; text-align: center; font-size: 0.75rem; color: #555; line-height: 1.6; }' +
    '.acciones { display: flex; gap: 10px; margin-top: 16px; max-width: 320px; width: 100%; }' +
    '.btn-accion { flex: 1; color: white; border: none; padding: 12px 8px; border-radius: 8px; cursor: pointer; font-size: 0.95rem; font-weight: 600; }' +
    '.btn-print { background: #2563eb; } .btn-save { background: #16a34a; } .btn-back { background: #475569; }' +
    '@media print { @page { size: 80mm auto; margin: 2mm 3mm; } html, body { width: 80mm; background: #fff; padding: 0; margin: 0; } .recibo-wrap { box-shadow: none; border-radius: 0; padding: 0; width: 74mm; max-width: 74mm; } .acciones { display: none; } table { font-size: 0.75rem; } td, th { padding: 3px 2px; } }' +
    '</style></head><body>' +
    '<div class="recibo-wrap">' + reciboHTML + '</div>' +
    '<div class="acciones">' + btns.join("") + '</div>' +
    '</body></html>';
}

// =============================================
// CONFIGURACIÓN DE IMPRESORA
// =============================================
// Imprimir recibo — abre nueva pestaña con el recibo y lanza el diálogo de impresión
function imprimirReciboWeb() {
    const recibo = document.getElementById("reciboImprimible");
    if (!recibo) return;
    const ventana = window.open("", "_blank");
    if (!ventana) { toast("Activa las ventanas emergentes para imprimir.", "warning"); return; }
    ventana.document.write(_getReciboPageHTML(recibo.outerHTML, true, false));
    ventana.document.close();
    setTimeout(() => { try { ventana.print(); } catch(e) {} }, 500);
}

// Guardar PDF — jsPDF puro con texto vectorial, sin html2canvas ni canvas
async function guardarReciboPDF() {
    const v = window._pdfVentaData;
    if (!v) { toast("No hay datos del recibo.", "error"); return; }

    if (typeof window.jspdf === "undefined") {
        toast("Cargando librería PDF...", "info");
        await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
            s.onload = resolve; s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    toast("Generando PDF...", "info");
    try {
        const { jsPDF } = window.jspdf;

        const empresa  = usuarioActivo?.empresa || "Mi Empresa";
        const vendedor = `${usuarioActivo?.nombre || ""} ${usuarioActivo?.apellido || ""}`.trim();

        // Dimensiones: rollo 80mm, márgenes 6mm cada lado → área útil 68mm
        const PW   = 80;
        const ML   = 6;
        const MR   = 6;
        const UTIL = PW - ML - MR; // 68mm
        const LS   = 5;

        const g = window._ventaGarantiaActual;
        const tieneGarantia = g && g.garantias && g.garantias.length > 0;

        // ── Pre-calcular altura exacta simulando el cursor ──
        // Necesitamos splitTextToSize para nombres largos — creamos PDF temporal solo para medir
        const _tmp = new jsPDF({ unit: "mm", format: [PW, 200] });
        _tmp.setFont("courier", "normal"); _tmp.setFontSize(8);
        const maxNomW = UTIL * 0.55;

        let _h = 10;                          // margen superior
        _h += 7;                              // empresa (bold 14)
        if (vendedor) _h += 4.5;             // vendedor
        _h += 5;                              // fecha
        _h += 4;                              // separador + gap
        _h += 5;                              // cabecera tabla
        _h += 3.5;                            // separador

        v.items.forEach(p => {
            const lineas = _tmp.splitTextToSize(p.nombre, maxNomW);
            _h += Math.max(lineas.length * 4, LS);
        });

        _h += 2 + 4 + 5 + 6;                 // sep + TOTAL + gap
        _h += 2 + 4 + 4 + 4;                 // sep + pie (2 líneas)

        if (tieneGarantia) {
            _h += 4 + 4.5 + 4 + 5;           // sep + título + cliente + id
            g.garantias.forEach(gi => {
                const lns = _tmp.splitTextToSize("Prod: " + (gi.producto_nombre || ""), UTIL);
                _h += 3.5 + (lns.length * 4) + 4 + 4; // sep + prod + codigo + vence
            });
        }

        const alturaFinal = _h + 8; // margen inferior

        // ── Crear PDF con tamaño exacto ──
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: [PW, alturaFinal] });

        let y = 10;

        // ── Helpers ──
        const txt = (texto, x, yPos, opts) => pdf.text(String(texto), x, yPos, opts || {});
        const dashedLine = (yPos) => {
            pdf.setLineDashPattern([1, 1], 0);
            pdf.setDrawColor(0);
            pdf.setLineWidth(0.2);
            pdf.line(ML, yPos, PW - MR, yPos);
        };

        // ── Encabezado ──
        pdf.setFont("courier", "bold");
        pdf.setFontSize(14);
        txt(empresa, PW / 2, y, { align: "center" });
        y += 7;

        pdf.setFont("courier", "normal");
        pdf.setFontSize(8);
        if (vendedor) { txt(vendedor, PW / 2, y, { align: "center" }); y += 4.5; }
        txt(v.fecha, PW / 2, y, { align: "center" });
        y += 5;
        dashedLine(y); y += 4;

        // ── Cabecera tabla ──
        pdf.setFont("courier", "bold");
        pdf.setFontSize(8);
        txt("Producto", ML,                    y);
        txt("Cant",     ML + UTIL * 0.62,      y, { align: "center" });
        txt("Precio",   ML + UTIL,             y, { align: "right" });
        y += 1.5;
        dashedLine(y); y += 3.5;

        // ── Filas ──
        pdf.setFont("courier", "normal");
        pdf.setFontSize(8);

        const xNom    = ML;
        const xCant   = ML + UTIL * 0.62;
        const xPrecio = ML + UTIL;

        v.items.forEach(p => {
            const precio   = parseFloat(p.precio) || 0;
            const cantidad = parseInt(p.cantidad) || 0;
            const lineas   = pdf.splitTextToSize(p.nombre, maxNomW);
            lineas.forEach((linea, i) => txt(linea, xNom, y + i * 4));
            txt(String(cantidad),         xCant,   y, { align: "center" });
            txt(formatter.format(precio), xPrecio, y, { align: "right" });
            y += Math.max(lineas.length * 4, LS);
        });

        // ── Total ──
        y += 2;
        dashedLine(y); y += 4;
        pdf.setFont("courier", "bold");
        pdf.setFontSize(9);
        txt("TOTAL:",                  ML,       y);
        txt(formatter.format(v.total), xPrecio,  y, { align: "right" });
        y += 6;

        // ── Garantía ──
        if (tieneGarantia) {
            dashedLine(y); y += 4;
            pdf.setFont("courier", "bold"); pdf.setFontSize(8);
            txt("GARANTIA", PW / 2, y, { align: "center" }); y += 4.5;
            pdf.setFont("courier", "normal");
            txt("Cliente: " + (g.clienteNombre || ""), ML, y); y += 4;
            txt("ID: "      + (g.clienteIdDoc  || ""), ML, y); y += 5;
            g.garantias.forEach(gi => {
                dashedLine(y); y += 3.5;
                const lns = pdf.splitTextToSize("Prod: " + (gi.producto_nombre || ""), UTIL);
                lns.forEach(l => { txt(l, ML, y); y += 4; });
                txt("Codigo: " + (gi.codigo_garantia || ""), ML, y); y += 4;
                const fv = gi.fecha_vencimiento
                    ? new Date(gi.fecha_vencimiento).toLocaleDateString("es-CO") : "";
                txt("Vence: " + fv, ML, y); y += 4;
            });
        }

        // ── Pie ──
        y += 2;
        dashedLine(y); y += 4;
        pdf.setFont("courier", "normal"); pdf.setFontSize(7.5);
        txt("Gracias por su compra!", PW / 2, y, { align: "center" }); y += 4;
        txt("Billing System",         PW / 2, y, { align: "center" });

        const nombreArchivo = "recibo_" + new Date().toISOString().slice(0, 10) + ".pdf";
        // Intentar descarga directa
        pdf.save(nombreArchivo);
        toast("PDF descargado.", "success");
    } catch (e) {
        console.error("Error generando PDF:", e);
        toast("No se pudo generar el PDF.", "error");
    }
}

function _cargarLibsPDF() {
    return new Promise((resolve) => {
        if (typeof window.jspdf === "undefined") {
            const s = document.createElement("script");
            s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
            s.onload = resolve;
            document.head.appendChild(s);
        } else { resolve(); }
    });
}

// Alias de compatibilidad
function imprimirRecibo() { imprimirReciboWeb(); }


// =============================================
// CIERRES
// =============================================
function renderCierres() {
    const lista = document.getElementById("listaCierres");
    if (!lista) return;
    lista.innerHTML = "";
    if (cierres.length === 0) {
        lista.innerHTML = `<p style="color:#94a3b8;text-align:center;padding:2rem 0;">No hay cierres registrados aún.</p>`; return;
    }
    cierres.forEach((c, i) => {
        const num = cierres.length - i;
        const tieneDetalle = c.detalleVentas && c.detalleVentas.length > 0;
        lista.innerHTML += `
        <div class="cierre-card">
            <div class="cierre-header">
                <span class="cierre-num">Turno #${num}</span>
                <span class="cierre-fecha">${c.fecha}</span>
            </div>
            <div class="cierre-body">
                <div class="cierre-stat"><span class="cierre-label">Total en caja</span><span class="cierre-valor verde">${formatter.format(c.saldoFinal)}</span></div>
                <div class="cierre-stat"><span class="cierre-label">Retiros</span><span class="cierre-valor rojo">${formatter.format(c.totalRetiros || 0)}</span></div>
                <div class="cierre-stat"><span class="cierre-label">Productos vendidos</span><span class="cierre-valor">${c.productosVendidos}</span></div>
            </div>
            ${tieneDetalle ? `<button onclick="verDetalleCierre(${i})" style="width:100%;margin-top:10px;padding:8px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:0.85rem;color:#334155;font-weight:500;">📋 Ver detalle de ventas (${c.detalleVentas.length})</button>` : ''}
        </div>`;
    });
}

function verDetalleCierre(idx) {
    const c = cierres[idx];
    if (!c || !c.detalleVentas) return;
    const num = cierres.length - idx;
    const modal = document.getElementById("modalDetalleCierre");
    document.getElementById("detalleCiereTitle").textContent = `Turno #${num} — ${c.fecha}`;

    let html = "";
    let totalGeneral = 0;
    c.detalleVentas.forEach((v, vi) => {
        totalGeneral += v.total || 0;
        const itemsHTML = (v.items || []).map(it => `
            <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:5px 0;border-bottom:1px solid #f1f5f9;gap:8px;">
                <span style="color:#1e293b;font-size:0.82rem;flex:1;min-width:0;word-break:break-word;">${it.nombre}</span>
                <span style="color:#475569;font-size:0.82rem;white-space:nowrap;margin-left:8px;">x${it.cantidad}</span>
                <span style="color:#1e293b;font-size:0.82rem;font-weight:600;white-space:nowrap;margin-left:8px;">${formatter.format(it.precio)}</span>
            </div>`).join("");
        html += `
        <div style="border:1px solid #cbd5e1;border-radius:8px;padding:10px 12px;margin-bottom:10px;background:#f8fafc;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <span style="font-size:0.78rem;color:#64748b;font-weight:500;">Venta #${vi + 1} · ${v.fecha || ''}</span>
                <span style="font-weight:700;color:#16a34a;font-size:0.88rem;white-space:nowrap;">${formatter.format(v.total || 0)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:0 0 4px;margin-bottom:2px;">
                <span style="font-size:0.75rem;color:#94a3b8;font-weight:600;">PRODUCTO</span>
                <span style="font-size:0.75rem;color:#94a3b8;font-weight:600;">CANT &nbsp; PRECIO</span>
            </div>
            ${itemsHTML}
        </div>`;
    });

    html += `<div style="text-align:right;padding:14px 16px;border-top:2px solid #334155;margin-top:8px;background:#0f172a;border-radius:0 0 10px 10px;font-weight:700;font-size:1rem;color:#f1f5f9;">Total del turno: <span style="color:#4ade80;font-size:1.1rem;">${formatter.format(totalGeneral)}</span></div>`;
    document.getElementById("detalleCierreContenido").innerHTML = html;
    modal.classList.add("active"); modal.classList.remove("oculto");
}

function cerrarDetalleCierre() {
    const m = document.getElementById("modalDetalleCierre");
    m.classList.add("oculto"); setTimeout(() => m.classList.remove("active"), 300);
}

// =============================================
// CAJA
// =============================================
function actualizarPanelCaja() {
    document.getElementById("displaySaldo").innerText   = formatter.format(saldoActual);
    document.getElementById("displayRetiros").innerText = formatter.format(totalRetiros * -1);
}
function verificarBloqueo() {
    const baseInput = document.getElementById("baseCaja");
    const baseBtn   = document.getElementById("btnGuardarBase");
    if (baseInput && baseBtn && cajaAbierta) { baseInput.disabled = true; baseBtn.disabled = true; }
}
async function guardarBase() {
    const valor = parsearMonto(document.getElementById("baseCaja").value);
    saldoActual += valor; cajaAbierta = true;
    await sb.from("caja").update({ saldo_actual: saldoActual, caja_abierta: true }).eq("id", cajaId);
    verificarBloqueo(); actualizarPanelCaja();
}
async function retirar() {
    const monto = parsearMonto(document.getElementById("montoRetiro").value);
    totalRetiros += monto; saldoActual -= monto;
    await sb.from("caja").update({ saldo_actual: saldoActual, total_retiros: totalRetiros }).eq("id", cajaId);
    // Registrar retiro
    const retiroData = { monto };
    if (usuarioActivo.es_sub) retiroData.sub_usuario_id = usuarioActivo.id;
    else retiroData.usuario_id = usuarioActivo.id;
    await sb.from("retiros").insert(retiroData);
    actualizarPanelCaja();
    toast("Retiro registrado.", "info");
}

// Modal cierre de caja
function cerrarCaja() {
    document.getElementById("inputEfectivoReal").value = "";
    document.getElementById("cierreError").textContent = "";
    const m = document.getElementById("modalCierreCaja");
    m.classList.add("active"); m.classList.remove("oculto");
}
function cerrarModalCierre() {
    const m = document.getElementById("modalCierreCaja");
    m.classList.add("oculto"); setTimeout(() => m.classList.remove("active"), 300);
}
async function confirmarCierreCaja() {
    const efectivoReal = parsearMonto(document.getElementById("inputEfectivoReal").value);
    const errEl = document.getElementById("cierreError");
    errEl.textContent = "";
    if (efectivoReal !== saldoActual) {
        const diff = efectivoReal - saldoActual;
        errEl.textContent = `No coincide. Diferencia: ${diff > 0 ? "+" : ""}${formatter.format(diff)}`; return;
    }
    // Contar solo ventas desde el último cierre usando fechas ISO
    const ultimoCierreISO = cierres.length > 0 ? new Date(cierres[0].fechaISO) : null;
    const ventasTurno = historial.filter(v => {
        if (!ultimoCierreISO) return true;
        return new Date(v.fechaISO) > ultimoCierreISO;
    });
    const totalVendidos = ventasTurno.reduce((acc, v) => acc + (v.cantProd || 0), 0);
    const resumenVentas = ventasTurno.map(v => ({ fecha: v.fecha, total: v.total, items: v.items }));
    const cierreData = { saldo_final: saldoActual, total_retiros: totalRetiros, productos_vendidos: totalVendidos, detalle_ventas: resumenVentas };
    if (usuarioActivo.es_sub) cierreData.sub_usuario_id = usuarioActivo.id;
    else cierreData.usuario_id = usuarioActivo.id;
    await sb.from("cierres").insert(cierreData);
    // Resetear caja
    await sb.from("caja").update({ saldo_actual: 0, total_retiros: 0, caja_abierta: false }).eq("id", cajaId);
    cerrarModalCierre();
    toast("Cierre de turno exitoso. ¡Hasta pronto!", "success");
    setTimeout(() => location.reload(), 1800);
}

// =============================================
// PANEL ADMIN
// =============================================
async function renderTablaAdmin() {
    const contenedor = document.getElementById("tablaAdmin");
    if (!contenedor) return;
    const { data: usuarios } = await sb.from("usuarios").select("*, sub_usuarios(*)").eq("es_admin", false);
    if (!usuarios || usuarios.length === 0) {
        contenedor.innerHTML = `<p style="color:#64748b;">No hay usuarios registrados aún.</p>`; return;
    }
    let html = `<table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:#f1f5f9;">
            <th style="padding:10px;text-align:left;">Usuario</th>
            <th style="padding:10px;text-align:left;">Nombre</th>
            <th style="padding:10px;text-align:left;">Empresa</th>
            <th style="padding:10px;text-align:center;">Estado</th>
            <th style="padding:10px;text-align:left;">Fecha Inicio</th>
            <th style="padding:10px;text-align:left;">Fecha Corte</th>
            <th style="padding:10px;text-align:center;">Sub-usuarios</th>
            <th style="padding:10px;text-align:center;">Acciones</th>
        </tr></thead><tbody>`;
    usuarios.forEach(u => {
        const estadoColor = u.activo ? "#22c55e" : "#ef4444";
        const estadoTexto = u.activo ? "Activo" : "Inactivo";
        const subCount    = (u.sub_usuarios || []).length;
        html += `<tr style="border-bottom:1px solid #e2e8f0;">
            <td style="padding:10px;font-weight:600;">@${u.user_name}</td>
            <td style="padding:10px;">${u.nombre} ${u.apellido}</td>
            <td style="padding:10px;">${u.empresa || "—"}</td>
            <td style="padding:10px;text-align:center;">
                <span style="background:${estadoColor}22;color:${estadoColor};padding:3px 10px;border-radius:20px;font-size:0.82rem;font-weight:600;">${estadoTexto}</span>
            </td>
            <td style="padding:10px;">
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="date" id="fi_${u.id}" value="${u.fecha_inicio || ''}" onchange="actualizarCampoAdmin('${u.id}','fecha_inicio',this.value)" style="padding:4px;font-size:0.82rem;width:140px;margin:0;">
                    <button onclick="limpiarFecha('${u.id}','fecha_inicio','fi_${u.id}')" style="background:#ef4444;color:white;padding:2px 7px;border-radius:5px;font-size:0.8rem;">✕</button>
                </div>
            </td>
            <td style="padding:10px;">
                <div style="display:flex;align-items:center;gap:4px;">
                    <input type="date" id="fc_${u.id}" value="${u.fecha_corte || ''}" onchange="actualizarCampoAdmin('${u.id}','fecha_corte',this.value)" style="padding:4px;font-size:0.82rem;width:140px;margin:0;">
                    <button onclick="limpiarFecha('${u.id}','fecha_corte','fc_${u.id}')" style="background:#ef4444;color:white;padding:2px 7px;border-radius:5px;font-size:0.8rem;">✕</button>
                </div>
            </td>
            <td style="padding:10px;text-align:center;">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <label style="font-size:0.78rem;color:#64748b;">Límite:</label>
                    <input type="number" min="0" value="${u.limite_sub || 0}" onchange="actualizarCampoAdmin('${u.id}','limite_sub',parseInt(this.value))" style="width:55px;padding:3px 6px;font-size:0.82rem;margin:0;border-radius:6px;">
                </div>
                <span style="font-size:0.75rem;color:#64748b;display:block;margin-bottom:6px;">${subCount} / ${u.limite_sub || 0} creados</span>
                ${(u.sub_usuarios||[]).map(s => `
                <div style="display:flex;justify-content:space-between;align-items:center;background:#f8fafc;padding:4px 8px;border-radius:6px;margin-bottom:3px;font-size:0.78rem;">
                    <span>@${s.user_name} — ${s.nombre}</span>
                    <button onclick="eliminarSubDesdeAdmin('${s.id}')" style="background:#ef4444;color:white;padding:2px 8px;border-radius:5px;font-size:0.75rem;">🗑</button>
                </div>`).join('')}
            </td>
            <td style="padding:10px;text-align:center;">
                <button onclick="toggleActivarAdmin('${u.id}',${u.activo})" style="background:${u.activo ? '#f59e0b' : '#22c55e'};color:white;padding:5px 12px;border-radius:6px;font-size:0.82rem;margin-bottom:4px;display:block;width:100%;">
                    ${u.activo ? '⏸ Desactivar' : '▶ Activar'}
                </button>
                <button onclick="eliminarUsuarioAdmin('${u.id}')" style="background:#ef4444;color:white;padding:5px 12px;border-radius:6px;font-size:0.82rem;display:block;width:100%;">
                    🗑 Eliminar
                </button>
            </td>
        </tr>`;
    });
    html += `</tbody></table>`;
    contenedor.innerHTML = html;
}

async function limpiarFecha(id, campo, inputId) {
    document.getElementById(inputId).value = "";
    await sb.from("usuarios").update({ [campo]: null }).eq("id", id);
    toast("Fecha eliminada.", "info");
}

async function actualizarCampoAdmin(id, campo, valor) {
    // Si el valor está vacío guardar null para limpiar el campo en Supabase
    const valorFinal = (valor === "" || valor === undefined) ? null : valor;
    await sb.from("usuarios").update({ [campo]: valorFinal }).eq("id", id);
    toast("Guardado.", "success");
}

async function toggleActivarAdmin(id, estadoActual) {
    await sb.from("usuarios").update({ activo: !estadoActual }).eq("id", id);
    renderTablaAdmin();
}

async function eliminarUsuarioAdmin(id) {
    if (!confirm("¿Eliminar permanentemente este usuario y todos sus datos?")) return;
    await sb.from("usuarios").delete().eq("id", id);
    toast("Usuario eliminado.", "info");
    renderTablaAdmin();
}

async function eliminarSubDesdeAdmin(subId) {
    if (!confirm("¿Eliminar este sub-usuario?")) return;
    await sb.from("sub_usuarios").delete().eq("id", subId);
    toast("Sub-usuario eliminado.", "info");
    await renderTablaAdmin(); // re-renderiza con contadores actualizados
}

// =============================================
// SUB-USUARIOS (gestión del dueño)
// =============================================
function verificarPermisoSub() {
    setTimeout(async () => {
        const menuSub = document.getElementById("menuSubUsuario");
        if (!menuSub || usuarioActivo?.es_sub || usuarioActivo?.es_admin) {
            if (menuSub) menuSub.style.display = "none"; return;
        }
        const { data } = await sb.from("usuarios").select("limite_sub").eq("id", usuarioActivo.id).maybeSingle();
        menuSub.style.display = (data?.limite_sub || 0) > 0 ? "block" : "none";
    }, 50);
}

async function abrirModalSub() {
    document.getElementById("subNombre").value = "";
    document.getElementById("subUser").value   = "";
    document.getElementById("subPass").value   = "";
    document.getElementById("subError").textContent   = "";
    document.getElementById("subSuccess").textContent = "";
    const { data } = await sb.from("usuarios").select("limite_sub").eq("id", usuarioActivo.id).maybeSingle();
    const chk = document.getElementById("chkCompartirInv");
    if (chk) chk.checked = false; // Cada sub tiene su propia config
    const { data: subs } = await sb.from("sub_usuarios").select("*").eq("dueno_id", usuarioActivo.id);
    const limite   = data?.limite_sub || 0;
    const actuales = (subs || []).length;
    const title = document.getElementById("subModalTitle");
    if (title) title.textContent = `Sub-usuarios (${actuales} / ${limite} disponibles)`;
    renderListaSubUsuarios(subs || []);
    const m = document.getElementById("modalSubUsuario");
    m.classList.add("active"); m.classList.remove("oculto");
}

function cerrarModalSub() {
    const m = document.getElementById("modalSubUsuario");
    m.classList.add("oculto"); setTimeout(() => m.classList.remove("active"), 300);
}

async function crearSubUsuario() {
    const nombre      = document.getElementById("subNombre").value.trim();
    const user        = document.getElementById("subUser").value.trim().toLowerCase();
    const pass        = document.getElementById("subPass").value;
    const compartirInv = document.getElementById("chkCompartirInv").checked;
    const errEl  = document.getElementById("subError");
    const okEl   = document.getElementById("subSuccess");
    errEl.textContent = ""; okEl.textContent = "";

    if (!nombre || !user || !pass) { errEl.textContent = "Completa todos los campos."; return; }
    if (pass.length < 6)           { errEl.textContent = "Contraseña mínimo 6 caracteres."; return; }

    // Verificar límite
    const { data: dueno } = await sb.from("usuarios").select("limite_sub").eq("id", usuarioActivo.id).maybeSingle();
    const { data: subs }  = await sb.from("sub_usuarios").select("id").eq("dueno_id", usuarioActivo.id);
    const limite   = dueno?.limite_sub || 0;
    const actuales = (subs || []).length;
    if (limite === 0)        { errEl.textContent = "No tienes permiso para crear sub-usuarios."; return; }
    if (actuales >= limite)  { errEl.textContent = `Alcanzaste tu límite de ${limite} sub-usuario${limite !== 1 ? 's' : ''}.`; return; }

    // Verificar usuario único
    const { data: existe1 } = await sb.from("usuarios").select("id").eq("user_name", user).maybeSingle();
    const { data: existe2 } = await sb.from("sub_usuarios").select("id").eq("user_name", user).maybeSingle();
    if (existe1 || existe2) { errEl.textContent = "Ese usuario ya existe."; return; }

    const { error } = await sb.from("sub_usuarios").insert({
        dueno_id: usuarioActivo.id, nombre, user_name: user, pass,
        compartir_inv: compartirInv
    });
    if (error) { errEl.textContent = "Error al crear sub-usuario."; return; }

    okEl.textContent = `✅ Sub-usuario @${user} creado.`;
    // Resetear checkbox para el próximo sub
    document.getElementById("chkCompartirInv").checked = false;
    document.getElementById("subNombre").value = "";
    document.getElementById("subUser").value   = "";
    document.getElementById("subPass").value   = "";
    abrirModalSub();
}

function renderListaSubUsuarios(subs) {
    const cont = document.getElementById("listaSubUsuarios");
    if (!cont || !subs.length) { if(cont) cont.innerHTML = ""; return; }
    let html = `<p style="font-size:0.82rem;font-weight:600;color:#64748b;margin-bottom:0.5rem;">Sub-usuarios creados</p>`;
    subs.forEach(s => {
        html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#f1f5f9;border-radius:8px;margin-bottom:6px;">
            <span style="font-size:0.88rem;font-weight:600;">👤 @${s.user_name} — ${s.nombre}</span>
            <button onclick="abrirModalEditSub('${s.id}','${s.user_name}','${s.nombre}')"
                style="background:#2563eb;color:white;padding:3px 10px;border-radius:6px;font-size:0.78rem;">
                ✏️ Editar
            </button>
        </div>`;
    });
    cont.innerHTML = html;
}

// --- Editar sub desde el dueño ---
function abrirModalEditSub(id, user_name, nombre) {
    document.getElementById("editSubId").value     = id;
    document.getElementById("editSubUser").value   = user_name;
    document.getElementById("editSubNombre").value = nombre;
    document.getElementById("editSubPass").value   = "";
    document.getElementById("editSubError").textContent   = "";
    document.getElementById("editSubSuccess").textContent = "";
    document.getElementById("modalEditSub").classList.add("active");
    document.getElementById("modalEditSub").classList.remove("oculto");
}

function cerrarModalEditSub() {
    const m = document.getElementById("modalEditSub");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

async function guardarEditSub() {
    const id      = document.getElementById("editSubId").value;
    const user    = document.getElementById("editSubUser").value.trim().toLowerCase();
    const nombre  = document.getElementById("editSubNombre").value.trim();
    const pass    = document.getElementById("editSubPass").value;
    const errEl   = document.getElementById("editSubError");
    const okEl    = document.getElementById("editSubSuccess");
    errEl.textContent = ""; okEl.textContent = "";

    if (!user || !nombre) { errEl.textContent = "Usuario y nombre son obligatorios."; return; }
    if (pass && pass.length < 6) { errEl.textContent = "Contraseña mínimo 6 caracteres."; return; }

    // Verificar que el nuevo user_name no exista en otro registro
    const { data: existe1 } = await sb.from("usuarios").select("id").eq("user_name", user).single();
    const { data: existe2 } = await sb.from("sub_usuarios").select("id").eq("user_name", user).neq("id", id).single();
    if (existe1 || existe2) { errEl.textContent = "Ese nombre de usuario ya existe."; return; }

    const updates = { user_name: user, nombre };
    if (pass) updates.pass = pass;

    const { error } = await sb.from("sub_usuarios").update(updates).eq("id", id);
    if (error) { errEl.textContent = "Error al guardar."; return; }

    okEl.textContent = "✅ Sub-usuario actualizado.";
    setTimeout(() => {
        cerrarModalEditSub();
        abrirModalSub(); // refrescar lista
    }, 1200);
    toast("Sub-usuario actualizado.", "success");
}

async function toggleCompartirInventario() {
    // El checkbox ahora es solo informativo al crear — no hace nada globalmente
}

// =============================================
// EDITAR PERFIL
// =============================================
function abrirModalPerfil() {
    if (usuarioActivo?.es_admin) return; // admin no edita perfil
    document.getElementById("perfilUser").value     = usuarioActivo.user_name || "";
    document.getElementById("perfilNombre").value   = usuarioActivo.nombre || "";
    document.getElementById("perfilApellido").value = usuarioActivo.apellido || "";
    document.getElementById("perfilEmail").value    = usuarioActivo.email || "";
    document.getElementById("perfilEmpresa").value  = usuarioActivo.empresa || "";
    document.getElementById("perfilPass").value     = "";
    document.getElementById("perfilError").textContent   = "";
    document.getElementById("perfilSuccess").textContent = "";
    // Sub-usuario no puede cambiar empresa
    const empField = document.getElementById("perfilEmpresa");
    if (usuarioActivo.es_sub) { empField.disabled = true; empField.style.opacity = "0.5"; }
    else { empField.disabled = false; empField.style.opacity = "1"; }
    const titulo = document.getElementById("perfilTitulo");
    if (titulo) titulo.textContent = usuarioActivo.es_sub ? "Editar mi perfil" : "Editar perfil";
    // Campos solo para dueños, no sub-usuarios
    const wompiGroup    = document.getElementById("perfilWompiGroup");
    const wompiInput    = document.getElementById("perfilWompiKey");
    const metodosGroup  = document.getElementById("perfilMetodosGroup");
    if (!usuarioActivo.es_sub) {
        wompiGroup.style.display   = "block";
        wompiInput.value           = "";
        wompiInput.placeholder     = usuarioActivo.wompi_key ? "••••••• (configurada — dejar vacío para no cambiar)" : "prv_prod_...";
        if (metodosGroup) metodosGroup.style.display = "block";
    } else {
        wompiGroup.style.display = "none";
        if (metodosGroup) metodosGroup.style.display = "none";
    }
    document.getElementById("modalPerfil").classList.add("active");
    document.getElementById("modalPerfil").classList.remove("oculto");
}

function cerrarModalPerfil() {
    const m = document.getElementById("modalPerfil");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

async function guardarPerfil() {
    const user     = document.getElementById("perfilUser").value.trim().toLowerCase();
    const nombre   = document.getElementById("perfilNombre").value.trim();
    const apellido = document.getElementById("perfilApellido").value.trim();
    const email    = document.getElementById("perfilEmail").value.trim();
    const empresa  = document.getElementById("perfilEmpresa").value.trim();
    const pass     = document.getElementById("perfilPass").value;
    const errEl    = document.getElementById("perfilError");
    const okEl     = document.getElementById("perfilSuccess");
    errEl.textContent = ""; okEl.textContent = "";

    if (!user || !nombre || !apellido) { errEl.textContent = "Usuario, nombre y apellido son obligatorios."; return; }
    if (pass && pass.length < 6) { errEl.textContent = "La contraseña debe tener al menos 6 caracteres."; return; }

    // Verificar que el nuevo user_name no exista en otro registro
    if (user !== usuarioActivo.user_name) {
        const { data: e1 } = await sb.from("usuarios").select("id").eq("user_name", user).single();
        const { data: e2 } = await sb.from("sub_usuarios").select("id").eq("user_name", user).single();
        if (e1 || e2) { errEl.textContent = "Ese nombre de usuario ya está en uso."; return; }
    }

    const wompiKey = document.getElementById("perfilWompiKey")?.value.trim();

    const updates = { user_name: user, nombre, apellido };
    if (pass) updates.pass = pass;

    if (usuarioActivo.es_sub) {
        const { error } = await sb.from("sub_usuarios").update(updates).eq("id", usuarioActivo.id);
        if (error) { errEl.textContent = "Error al guardar."; return; }
    } else {
        updates.empresa = empresa;
        if (email) updates.email = email;
        if (wompiKey) updates.wompi_key = wompiKey;
        const { error } = await sb.from("usuarios").update(updates).eq("id", usuarioActivo.id);
        if (error) { errEl.textContent = "Error al guardar."; return; }
    }

    const wompiKeyActual = wompiKey || usuarioActivo.wompi_key;
    usuarioActivo = { ...usuarioActivo, user_name: user, nombre, apellido,
        email:     usuarioActivo.es_sub ? usuarioActivo.email    : (email    || usuarioActivo.email),
        empresa:   usuarioActivo.es_sub ? usuarioActivo.empresa  : empresa,
        wompi_key: usuarioActivo.es_sub ? undefined : wompiKeyActual
    };
    sessionStorage.setItem("bs_sesion", JSON.stringify(usuarioActivo));
    mostrarBadge(usuarioActivo);
    okEl.textContent = "✅ Perfil actualizado.";
    setTimeout(() => cerrarModalPerfil(), 1500);
    toast("Perfil actualizado.", "success");
}

// =============================================
// ELIMINAR CUENTA PROPIA
// =============================================
function confirmarEliminarCuenta() {
    if (usuarioActivo?.es_sub) {
        toast("Los sub-usuarios no pueden eliminar su cuenta. Pídele al dueño.", "warning");
        return;
    }
    document.getElementById("modalEliminarCuenta").classList.add("active");
    document.getElementById("eliminarCuentaError").textContent = "";
    document.getElementById("eliminarCuentaConfirm").value = "";
}

function cerrarEliminarCuenta() {
    document.getElementById("modalEliminarCuenta").classList.remove("active");
}

async function ejecutarEliminarCuenta() {
    const confirmText = document.getElementById("eliminarCuentaConfirm").value.trim();
    const errEl = document.getElementById("eliminarCuentaError");
    if (confirmText !== "ELIMINAR") {
        errEl.textContent = 'Escribe ELIMINAR exactamente para confirmar.';
        return;
    }
    const id = usuarioActivo.id;
    errEl.textContent = "";

    // Eliminar datos relacionados en orden (FK constraints)
    await sb.from("reclamaciones_garantia").delete().eq("usuario_id", id);
    await sb.from("registros_garantia").delete().eq("usuario_id", id);
    await sb.from("metodos_pago").delete().eq("dueno_id", id);
    await sb.from("cierres").delete().eq("usuario_id", id);
    await sb.from("retiros").delete().eq("usuario_id", id);
    await sb.from("ventas").update({ usuario_id: null }).eq("usuario_id", id);
    await sb.from("caja").delete().eq("usuario_id", id);

    // Eliminar sub-usuarios del dueño y sus datos
    const { data: subs } = await sb.from("sub_usuarios").select("id").eq("dueno_id", id);
    if (subs?.length) {
        const subIds = subs.map(s => s.id);
        await sb.from("reclamaciones_garantia").delete().in("sub_usuario_id", subIds);
        await sb.from("registros_garantia").delete().in("sub_usuario_id", subIds);
        await sb.from("cierres").delete().in("sub_usuario_id", subIds);
        await sb.from("retiros").delete().in("sub_usuario_id", subIds);
        await sb.from("ventas").update({ sub_usuario_id: null }).in("sub_usuario_id", subIds);
        await sb.from("caja").delete().in("sub_usuario_id", subIds);
        await sb.from("inventario").delete().in("sub_id", subIds);
        await sb.from("sub_usuarios").delete().eq("dueno_id", id);
    }

    // Inventario propio
    await sb.from("inventario").delete().eq("dueno_id", id);

    // Finalmente eliminar el usuario
    const { error } = await sb.from("usuarios").delete().eq("id", id);
    if (error) { errEl.textContent = "Error al eliminar la cuenta: " + error.message; return; }

    clearInterval(_sesionCheckInterval); _sesionCheckInterval = null;
    sessionStorage.clear();
    usuarioActivo = null; cajaId = null;
    cerrarEliminarCuenta();
    mostrarAuth();
    toast("Cuenta eliminada permanentemente.", "info");
}

// =============================================
// GARANTÍAS
// =============================================
function toggleGarantiaDias() {
    const chk = document.getElementById("tieneGarantia");
    document.getElementById("diasGarantiaGroup").style.display = chk.checked ? "block" : "none";
}
function toggleEditGarantiaDias() {
    const chk = document.getElementById("editTieneGarantia");
    document.getElementById("editDiasGarantiaGroup").style.display = chk.checked ? "block" : "none";
}

async function cargarListaGarantias() {
    const lista = document.getElementById("listaGarantias");
    if (!lista) return;

    // Cargar garantías del usuario O de sus sub-usuarios
    let query = sb.from("registros_garantia").select("*, reclamaciones_garantia(*)");
    if (usuarioActivo.es_sub) {
        query = query.eq("sub_usuario_id", usuarioActivo.id);
    } else {
        // Dueño ve sus garantías y las de sus subs
        const { data: subs } = await sb.from("sub_usuarios").select("id").eq("dueno_id", usuarioActivo.id);
        const subIds = (subs || []).map(s => s.id);
        if (subIds.length > 0) {
            query = query.or(`usuario_id.eq.${usuarioActivo.id},${subIds.map(id => `sub_usuario_id.eq.${id}`).join(",")}`);
        } else {
            query = query.eq("usuario_id", usuarioActivo.id);
        }
    }
    const { data } = await query.order("fecha_venta", { ascending: false });

    if (!data || data.length === 0) {
        lista.innerHTML = `<p style="color:#94a3b8;text-align:center;padding:1rem;">No hay garantías registradas.</p>`;
        return;
    }

    lista.innerHTML = data.map(g => {
        const hoy       = new Date();
        const venc      = new Date(g.fecha_vencimiento);
        const vigente   = hoy <= venc;
        const reclamaciones = g.reclamaciones_garantia || [];
        const usada     = reclamaciones.length > 0;

        let estadoBadge;
        if (usada) {
            estadoBadge = `<span style="background:#fef3c7;color:#d97706;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">⚠️ Usada</span>`;
        } else if (vigente) {
            estadoBadge = `<span style="background:#dcfce7;color:#16a34a;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">✅ Vigente</span>`;
        } else {
            estadoBadge = `<span style="background:#fee2e2;color:#dc2626;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;">❌ Vencida</span>`;
        }

        // Historial de reclamaciones
        let reclaHtml = "";
        if (reclamaciones.length > 0) {
            reclaHtml = `<div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px;">
                <p style="font-size:0.78rem;font-weight:700;color:#64748b;margin:0 0 6px;">📋 Reclamaciones:</p>`;
            reclamaciones.forEach(r => {
                reclaHtml += `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:6px 10px;margin-bottom:4px;font-size:0.78rem;">
                    <div><b>${r.motivo}</b> — ${new Date(r.fecha_reclamacion).toLocaleDateString('es-CO')}</div>
                    ${r.observaciones ? `<div style="color:#64748b;margin-top:2px;">${r.observaciones}</div>` : ""}
                </div>`;
            });
            reclaHtml += `</div>`;
        }

        // Botón reclamar solo si vigente y no usada
        const btnReclamar = (vigente && !usada)
            ? `<button onclick="abrirModalReclamacion('${g.id}','${g.producto_nombre}','${g.cliente_nombre}','${g.codigo_garantia}')"
                style="background:#f59e0b;color:white;padding:4px 12px;border-radius:6px;font-size:0.82rem;margin-top:8px;">
                ⚠️ Reclamar garantía
               </button>`
            : "";

        return `<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:1rem;margin-bottom:0.75rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <span style="font-weight:700;font-size:0.95rem;">🛡️ ${g.producto_nombre}</span>
                ${estadoBadge}
            </div>
            <div style="font-size:0.82rem;color:#64748b;display:grid;grid-template-columns:1fr 1fr;gap:4px;">
                <span>👤 ${g.cliente_nombre}</span>
                <span>🪪 ${g.cliente_id}</span>
                <span>🔑 ${g.codigo_garantia}</span>
                <span>📅 Vence: ${new Date(g.fecha_vencimiento).toLocaleDateString('es-CO')}</span>
            </div>
            ${reclaHtml}
            ${btnReclamar}
        </div>`;
    }).join("");
}

async function buscarGarantias() {
    const query  = document.getElementById("buscarGarantia").value.trim();
    const result = document.getElementById("resultadoGarantia");
    if (!query) return;

    // Cargar garantías CON sus reclamaciones
    const { data } = await sb.from("registros_garantia")
        .select("*, reclamaciones_garantia(*)")
        .or(`cliente_id.eq.${query},codigo_garantia.eq.${query}`);

    if (!data || data.length === 0) {
        result.innerHTML = `<p style="color:#ef4444;font-weight:600;">No se encontraron garantías para ese dato.</p>`; return;
    }
    const hoy = new Date();
    result.innerHTML = data.map(g => {
        const venc        = new Date(g.fecha_vencimiento);
        const vigente     = hoy <= venc;
        const reclamaciones = g.reclamaciones_garantia || [];
        const usada       = reclamaciones.length > 0;

        let borderColor, estadoBadge;
        if (usada) {
            borderColor  = "#d97706";
            estadoBadge  = `<span style="background:#fef3c7;color:#d97706;padding:4px 14px;border-radius:20px;font-weight:700;">⚠️ USADA</span>`;
        } else if (vigente) {
            borderColor  = "#16a34a";
            estadoBadge  = `<span style="background:#dcfce7;color:#16a34a;padding:4px 14px;border-radius:20px;font-weight:700;">✅ VIGENTE</span>`;
        } else {
            borderColor  = "#dc2626";
            estadoBadge  = `<span style="background:#fee2e2;color:#dc2626;padding:4px 14px;border-radius:20px;font-weight:700;">❌ VENCIDA</span>`;
        }

        // Historial reclamaciones
        let reclaHtml = "";
        if (reclamaciones.length > 0) {
            reclaHtml = `<div style="margin-top:8px;border-top:1px solid #e2e8f0;padding-top:8px;">
                <p style="font-size:0.78rem;font-weight:700;color:#64748b;margin:0 0 6px;">📋 Reclamaciones:</p>`;
            reclamaciones.forEach(r => {
                reclaHtml += `<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:6px 10px;margin-bottom:4px;font-size:0.78rem;">
                    <div><b>${r.motivo}</b> — ${new Date(r.fecha_reclamacion).toLocaleDateString('es-CO')}</div>
                    ${r.observaciones ? `<div style="color:#64748b;margin-top:2px;">${r.observaciones}</div>` : ""}
                </div>`;
            });
            reclaHtml += `</div>`;
        }

        const btnReclamarBusqueda = (vigente && !usada)
            ? `<button onclick="abrirModalReclamacion('${g.id}','${g.producto_nombre}','${g.cliente_nombre}','${g.codigo_garantia}')"
                style="background:#f59e0b;color:white;padding:5px 14px;border-radius:6px;font-size:0.85rem;margin-top:10px;display:block;">
                ⚠️ Reclamar garantía
               </button>`
            : "";

        return `<div style="background:#f8fafc;border:2px solid ${borderColor};border-radius:14px;padding:1.2rem;margin-bottom:0.75rem;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <strong style="font-size:1rem;">🛡️ ${g.producto_nombre}</strong>
                ${estadoBadge}
            </div>
            <div style="font-size:0.88rem;color:#475569;display:grid;grid-template-columns:1fr 1fr;gap:6px;">
                <span>👤 <b>Cliente:</b> ${g.cliente_nombre}</span>
                <span>🪪 <b>ID:</b> ${g.cliente_id}</span>
                <span>🔑 <b>Código:</b> ${g.codigo_garantia}</span>
                <span>📅 <b>Vence:</b> ${venc.toLocaleDateString('es-CO')}</span>
                <span>🗓️ <b>Compra:</b> ${new Date(g.fecha_venta).toLocaleDateString('es-CO')}</span>
            </div>
            ${reclaHtml}
            ${btnReclamarBusqueda}
        </div>`;
    }).join("");
}

// Cargar garantías al entrar a la sección
document.addEventListener("DOMContentLoaded", () => {
    const origShow = window.show;
    window.show = function(id) {
        origShow(id);
        if (id === "garantias" && usuarioActivo) cargarListaGarantias();
    };
});

// =============================================
// RECLAMACIONES DE GARANTÍA
// =============================================
function toggleReclamacionOtro() {
    const motivo = document.getElementById("reclamacionMotivo").value;
    document.getElementById("reclamacionOtroGroup").style.display = motivo === "Otro" ? "block" : "none";
}

function abrirModalReclamacion(garantiaId, producto, cliente, codigo) {
    document.getElementById("reclamacionGarantiaId").value = garantiaId;
    document.getElementById("reclamacionMotivo").value     = "";
    document.getElementById("reclamacionOtro").value      = "";
    document.getElementById("reclamacionObs").value       = "";
    document.getElementById("reclamacionError").textContent = "";
    document.getElementById("reclamacionOtroGroup").style.display = "none";
    document.getElementById("reclamacionInfoProducto").innerHTML =
        `<b>Producto:</b> ${producto} &nbsp;|&nbsp; <b>Cliente:</b> ${cliente} &nbsp;|&nbsp; <b>Código:</b> ${codigo}`;
    document.getElementById("modalReclamacion").classList.add("active");
    document.getElementById("modalReclamacion").classList.remove("oculto");
}

function cerrarModalReclamacion() {
    const m = document.getElementById("modalReclamacion");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

async function confirmarReclamacion() {
    const garantiaId = document.getElementById("reclamacionGarantiaId").value;
    const motivoSel  = document.getElementById("reclamacionMotivo").value;
    const motivoOtro = document.getElementById("reclamacionOtro").value.trim();
    const obs        = document.getElementById("reclamacionObs").value.trim();
    const errEl      = document.getElementById("reclamacionError");
    errEl.textContent = "";

    if (!motivoSel) { errEl.textContent = "Selecciona un motivo."; return; }
    if (motivoSel === "Otro" && !motivoOtro) { errEl.textContent = "Describe el motivo."; return; }

    const motivo = motivoSel === "Otro" ? motivoOtro : motivoSel;
    const reclaData = {
        garantia_id:    garantiaId,
        motivo,
        observaciones:  obs || null
    };
    if (usuarioActivo.es_sub) reclaData.sub_usuario_id = usuarioActivo.id;
    else reclaData.usuario_id = usuarioActivo.id;

    const { error } = await sb.from("reclamaciones_garantia").insert(reclaData);
    if (error) { errEl.textContent = "Error al registrar. Intenta de nuevo."; return; }

    cerrarModalReclamacion();
    toast("Reclamación registrada exitosamente.", "success");
    await cargarListaGarantias();
}

// =============================================
// EXPORTAR INVENTARIO PDF
// =============================================
async function exportarInventarioPDF(filtro) {
    let productos = [...inventario];
    let titulo = "Inventario completo";
    let subtitulo = "";

    if (filtro === "bajo") {
        productos = productos.filter(p => p.stock > 0 && p.stock <= 3);
        titulo    = "Stock bajo";
        subtitulo = "Productos con 3 unidades o menos";
    } else if (filtro === "agotado") {
        productos = productos.filter(p => p.stock === 0);
        titulo    = "Productos agotados";
        subtitulo = "Sin unidades disponibles";
    }

    if (productos.length === 0) {
        toast("No hay productos para exportar con ese filtro.", "warning");
        return;
    }

    if (typeof html2canvas === "undefined" || typeof window.jspdf === "undefined") {
        toast("Cargando librerías PDF...", "info");
        await _cargarLibsPDF();
    }
    toast("Generando PDF...", "info");

    try {
        const { jsPDF } = window.jspdf;
        const empresa = usuarioActivo?.empresa || "Mi Empresa";
        const nombre  = `${usuarioActivo?.nombre || ""} ${usuarioActivo?.apellido || ""}`.trim();
        const fecha   = new Date().toLocaleDateString("es-CO");

        // Carta landscape: 279×216mm = 1056×817px a 96dpi
        // Wrapper = exactamente 1056px → se mapea 1:1 a 279mm sin desborde
        const WRAP_W = 1056;
        const PAD    = 60; // px margen lateral (≈16mm)

        const filas = productos.map(p => {
            const stockColor = p.stock === 0
                ? "color:#dc2626;font-weight:700;"
                : p.stock <= 3 ? "color:#d97706;font-weight:700;" : "";
            return `<tr>
                <td style="width:70px;white-space:nowrap;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;">${p.prod_id}</td>
                <td style="padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;word-break:break-word;">${p.nombre}</td>
                <td style="width:80px;white-space:nowrap;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;text-align:center;${stockColor}">${p.stock}</td>
                <td style="width:145px;white-space:nowrap;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;text-align:right;">${formatter.format(p.precio)}</td>
                <td style="width:145px;white-space:nowrap;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;text-align:right;">${p.precio_min ? formatter.format(p.precio_min) : "—"}</td>
                <td style="width:110px;white-space:nowrap;padding:7px 10px;border-bottom:1px solid #e2e8f0;font-size:0.85rem;text-align:center;">${p.tiene_garantia ? p.dias_garantia + " días" : "—"}</td>
            </tr>`;
        }).join("");

        const htmlContent = `
            <div style="font-family:Arial,sans-serif;color:#000;width:${WRAP_W}px;padding:40px ${PAD}px;background:#fff;box-sizing:border-box;">
                <div style="text-align:center;border-bottom:2px solid #1e293b;padding-bottom:14px;margin-bottom:18px;">
                    <div style="font-size:1.4rem;font-weight:700;">${empresa}</div>
                    <div style="font-size:0.85rem;color:#555;margin-top:3px;">${nombre} — ${fecha}</div>
                    <div style="font-size:1rem;font-weight:700;margin-top:8px;">${titulo}</div>
                    ${subtitulo ? `<div style="font-size:0.8rem;color:#888;margin-top:2px;">${subtitulo}</div>` : ""}
                    <div style="font-size:0.8rem;color:#888;margin-top:2px;">${productos.length} producto${productos.length !== 1 ? "s" : ""}</div>
                </div>
                <table style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr style="background:#1e293b;color:#fff;">
                            <th style="width:70px;padding:9px 10px;text-align:left;font-size:0.82rem;">ID</th>
                            <th style="padding:9px 10px;text-align:left;font-size:0.82rem;">Nombre</th>
                            <th style="width:80px;padding:9px 10px;text-align:center;font-size:0.82rem;">Stock</th>
                            <th style="width:145px;padding:9px 10px;text-align:right;font-size:0.82rem;">Precio</th>
                            <th style="width:145px;padding:9px 10px;text-align:right;font-size:0.82rem;">Precio Mín.</th>
                            <th style="width:110px;padding:9px 10px;text-align:center;font-size:0.82rem;">Garantía</th>
                        </tr>
                    </thead>
                    <tbody>${filas}</tbody>
                </table>
                <div style="text-align:center;margin-top:16px;font-size:0.72rem;color:#aaa;border-top:1px solid #e2e8f0;padding-top:10px;">
                    Generado por Billing System — ${new Date().toLocaleString("es-CO")}
                </div>
            </div>`;

        const wrapper = document.createElement("div");
        wrapper.style.cssText = [
            "position:fixed","left:-9999px","top:0","z-index:-1",
            `width:${WRAP_W}px`,"background:#fff","box-sizing:border-box","overflow:visible"
        ].join(";");
        wrapper.innerHTML = htmlContent;
        document.body.appendChild(wrapper);

        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

        const canvas = await html2canvas(wrapper, {
            scale: 2, useCORS: true, backgroundColor: "#ffffff",
            logging: false, width: WRAP_W, height: wrapper.scrollHeight, windowWidth: WRAP_W
        });
        document.body.removeChild(wrapper);

        // Carta landscape = 279×216mm. WRAP_W=1056px → 1056/279mm = 3.785 px/mm ≈ 96dpi exacto
        const imgData  = canvas.toDataURL("image/png");
        const pdfW     = 279;
        const pxPerMm  = (WRAP_W * 2) / pdfW;                        // scale×2 reales
        const pdfH     = Math.max(216, Math.ceil(canvas.height / pxPerMm));

        const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [pdfW, pdfH] });
        pdf.addImage(imgData, "PNG", 0, 0, pdfW, Math.ceil(canvas.height / pxPerMm), "", "FAST");

        const nombreFiltro = filtro === "bajo" ? "stock_bajo" : filtro === "agotado" ? "agotados" : "completo";
        pdf.save(`inventario_${nombreFiltro}_${new Date().toISOString().slice(0,10)}.pdf`);
        toast("PDF descargado.", "success");

    } catch (e) {
        console.error("Error exportando inventario PDF:", e);
        toast("No se pudo generar el PDF.", "error");
    }
}

// =============================================
// RECUPERAR CONTRASEÑA
// =============================================
function abrirModalRecuperar() {
    document.getElementById("recupUser").value    = "";
    document.getElementById("recupEmail").value   = "";
    document.getElementById("recupError").textContent   = "";
    document.getElementById("recupSuccess").textContent = "";
    document.getElementById("modalRecuperar").classList.add("active");
    document.getElementById("modalRecuperar").classList.remove("oculto");
}

function cerrarModalRecuperar() {
    const m = document.getElementById("modalRecuperar");
    m.classList.add("oculto");
    setTimeout(() => m.classList.remove("active"), 300);
}

function generarPassTemporal() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    let pass = "";
    for (let i = 0; i < 8; i++) pass += chars[Math.floor(Math.random() * chars.length)];
    return pass;
}

async function enviarRecuperacion() {
    const user  = document.getElementById("recupUser").value.trim().toLowerCase();
    const email = document.getElementById("recupEmail").value.trim().toLowerCase();
    const errEl = document.getElementById("recupError");
    const okEl  = document.getElementById("recupSuccess");
    errEl.textContent = ""; okEl.textContent = "";

    if (!user || !email) { errEl.textContent = "Completa todos los campos."; return; }

    // Control: máximo 2 recuperaciones por día — verificar en Supabase
    const hoy = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
    const { data: intento } = await sb.from("intentos_recuperacion")
        .select("fecha, conteo")
        .eq("user_name", user)
        .maybeSingle();

    if (intento && intento.fecha === hoy && intento.conteo >= 2) {
        errEl.textContent = "Límite alcanzado. Solo puedes recuperar la contraseña 2 veces por día.";
        return;
    }

    // Buscar usuario en Supabase
    const { data: found } = await sb.from("usuarios")
        .select("id, nombre, user_name, email")
        .eq("user_name", user)
        .maybeSingle();

    if (!found) { errEl.textContent = "Usuario no encontrado."; return; }
    if (!found.email || found.email.toLowerCase() !== email) {
        errEl.textContent = "El correo no coincide con el registrado."; return;
    }

    // Generar contraseña temporal
    const nuevaPass = generarPassTemporal();

    // Actualizar en Supabase
    const { error } = await sb.from("usuarios").update({ pass: nuevaPass }).eq("id", found.id);
    if (error) { errEl.textContent = "Error al actualizar. Intenta de nuevo."; return; }

    // Enviar email con EmailJS
    try {
        await emailjs.send("service_0v5b7oy", "template_58js6ch", {
            to_name:      found.nombre,
            to_email:     email,
            new_password: nuevaPass
        });
        // Actualizar conteo en Supabase
        const esHoy      = intento && intento.fecha === hoy;
        const nuevoConteo = esHoy ? intento.conteo + 1 : 1;
        await sb.from("intentos_recuperacion").upsert({
            user_name: user,
            fecha:     hoy,
            conteo:    nuevoConteo
        }, { onConflict: "user_name" });
        const restantes = 2 - nuevoConteo;
        okEl.textContent = "✅ Contraseña temporal enviada a tu correo. Cámbiala después de ingresar." +
            (restantes > 0 ? " (" + restantes + " intento" + (restantes > 1 ? "s" : "") + " restante hoy)" : "");
    } catch (e) {
        errEl.textContent = "Error al enviar el correo. Verifica tu email.";
        return;
    }
}