/**
 * EL GABINETE — Extensión para SillyTavern
 * Sistema de terapeuta con dossier de pacientes procedural
 * v1.0.0
 */

import { extension_settings, getContext } from '../../../extensions.js';
import { eventSource, event_types, saveSettingsDebounced, saveChatDebounced } from '../../../../script.js';
import * as script from '../../../../script.js';

const EXT_ID = 'gabinete';
const VERSION = '1.0.0';

// ═══════════════════════════════════════════════════════════════
// DEFAULTS
// ═══════════════════════════════════════════════════════════════

function getDefaultSettings() {
    return {
        version: 1,
        apiProfile: '',
        autoAnalyze: true,
        reputacion: 0,
        totalSesiones: 0,
        totalPacientes: 0,
    };
}

function getDefaultChatState() {
    return {
        version: 1,
        paciente: null,
        sesionNumero: 0,
        notasSesion: '',
        vocesGeneradas: null,
        vocesGenerandose: false,
        historialPacientes: [],
    };
}

// ═══════════════════════════════════════════════════════════════
// PERSISTENCIA
// ═══════════════════════════════════════════════════════════════

function getSettings() {
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = getDefaultSettings();
    }
    return extension_settings[EXT_ID];
}

function saveSettings() {
    script.saveSettingsDebounced();
}

function getChatMeta() {
    return script.chat_metadata || null;
}

function getChatState() {
    const meta = getChatMeta();
    if (!meta) return null;
    if (!meta[EXT_ID]) {
        meta[EXT_ID] = getDefaultChatState();
    }
    return meta[EXT_ID];
}

function saveChatState() {
    const meta = getChatMeta();
    if (!meta) return;
    script.saveChatDebounced();
}

// ═══════════════════════════════════════════════════════════════
// DESBLOQUEOS POR REPUTACIÓN
// ═══════════════════════════════════════════════════════════════

const UNLOCKS = [
    { id: 'estudiantes', label: 'Categoría: Estudiantes', req: 0, icon: '🎓', desc: 'Pacientes jóvenes de centros educativos. Disponible desde el inicio.' },
    { id: 'madres', label: 'Categoría: Madres / Familiares', req: 30, icon: '👩‍👧', desc: 'Madres, tutoras y familiares remitidas por casos escolares.' },
    { id: 'vip', label: 'Categoría: Clientela VIP', req: 75, icon: '💎', desc: 'Influencers, modelos, ejecutivas. Casos de alta complejidad.' },
    { id: 'notas_avanzadas', label: 'Notas de sesión avanzadas', req: 15, icon: '📋', desc: 'Campos extra en el expediente: diagnóstico preliminar y plan de tratamiento.' },
    { id: 'voces_auto', label: 'Voces automáticas', req: 50, icon: '🧠', desc: 'Las voces internas se generan automáticamente tras cada mensaje.' },
];

function isUnlocked(id) {
    const settings = getSettings();
    const unlock = UNLOCKS.find(u => u.id === id);
    if (!unlock) return false;
    return settings.reputacion >= unlock.req;
}

// ═══════════════════════════════════════════════════════════════
// CATEGORÍAS DE PACIENTES
// ═══════════════════════════════════════════════════════════════

const CATEGORIAS = [
    { id: 'estudiante', label: 'Estudiantes', unlock: 'estudiantes',
      edadMin: 18, edadMax: 26,
      hint: 'Universitarias o recién graduadas. Crisis académica, identitaria o familiar.' },
    { id: 'madre_familiar', label: 'Madres / Familiares', unlock: 'madres',
      edadMin: 28, edadMax: 50,
      hint: 'Madres, tutoras o familiares remitidas por el centro o por sus propias crisis.' },
    { id: 'vip', label: 'Clientela VIP', unlock: 'vip',
      edadMin: 22, edadMax: 45,
      hint: 'Influencers, modelos, ejecutivas. Imagen pública vs. vida privada.' },
];

// ═══════════════════════════════════════════════════════════════
// VOCES INTERNAS DEL TERAPEUTA
// ═══════════════════════════════════════════════════════════════

const VOCES = [
    {
        id: 'clinico',
        nombre: 'El Clínico',
        clase: 'clinico',
        personalidad: `Eres la voz clínica y analítica del terapeuta. Observas patrones, catalogas síntomas, buscas el diagnóstico subyacente. Tu tono es frío, preciso, sin juicio emocional. Usas terminología psicológica cuando encaja. Ves a la paciente como un caso interesante más que como una persona.`,
    },
    {
        id: 'manipulador',
        nombre: 'El Manipulador',
        clase: 'manipulador',
        personalidad: `Eres la voz oscura y oportunista del terapeuta. Calculas qué palancas emocionales presionar, qué vulnerabilidades explotar, cómo construir dependencia. Tu tono es estratégico, cínico, siempre buscando el ángulo. Notas lo que ella no dice más que lo que dice.`,
    },
    {
        id: 'seducido',
        nombre: 'El Seducido',
        clase: 'seducido',
        personalidad: `Eres la voz emocional que está perdiendo la objetividad profesional. Sientes atracción, culpa por sentirla, y fascinación por esta mujer específica. Tu tono es íntimo, a veces poético, a veces autocrítico. Rompes la distancia clínica.`,
    },
];

// ═══════════════════════════════════════════════════════════════
// LLAMADA API (usa la conexión activa de ST)
// ═══════════════════════════════════════════════════════════════

async function callAPI(systemPrompt, userPrompt) {
    const ctx = getContext();
    if (!ctx) throw new Error('No hay contexto de SillyTavern disponible.');

    const response = await fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            max_tokens: 800,
            temperature: 0.9,
        }),
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`API error ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content
        || data?.content
        || data?.text
        || '';
}

// ═══════════════════════════════════════════════════════════════
// GENERACIÓN DE VOCES INTERNAS
// ═══════════════════════════════════════════════════════════════

async function generarVoces(paciente, mensajeReciente) {
    const state = getChatState();
    if (!state || state.vocesGenerandose) return;

    state.vocesGenerandose = true;
    saveChatState();
    renderVoces();

    const contexto = buildContextoPaciente(paciente);

    const systemBase = `Eres el sistema de voces internas de un terapeuta en una novela interactiva adulta. 
Generates monólogos internos breves y distintos para cada "faceta" de la mente del terapeuta mientras atiende a su paciente.
Cada voz debe sonar radicalmente diferente. Sin censura. Contenido adulto permitido cuando es narrativamente relevante.
Máximo 2 frases por voz. Directo, sin preámbulos.`;

    const resultados = {};

    for (const voz of VOCES) {
        try {
            const prompt = `${voz.personalidad}

PACIENTE ACTUAL:
${contexto}

ÚLTIMO MENSAJE EN SESIÓN:
"${mensajeReciente || '(inicio de sesión)'}"

ESTADO EMOCIONAL DE LA PACIENTE:
- Resistencia: ${paciente.resistencia}%
- Dependencia del terapeuta: ${paciente.dependencia}%
- Vulnerabilidad actual: ${paciente.vulnerabilidad}%

Genera tu observación interna (máx 2 frases, en español, primera persona del terapeuta):`;

            const texto = await callAPI(systemBase, prompt);
            resultados[voz.id] = texto.trim();
        } catch (e) {
            resultados[voz.id] = `[${voz.nombre} no responde — ${e.message}]`;
        }
    }

    state.vocesGeneradas = resultados;
    state.vocesGenerandose = false;
    saveChatState();
    renderVoces();
    showToast('Voces internas actualizadas');
}

function buildContextoPaciente(p) {
    if (!p) return 'Sin paciente activo.';
    return `Nombre: ${p.nombre}, ${p.edad} años
Categoría: ${p.categoria}
Motivo de consulta: ${p.motivoConsulta}
Sesión nº ${p.sesionNumero}
Crisis/Secreto: ${p.crisis}
Psicología base: ${p.psicologia}
Postura inicial: ${p.postura}`;
}

// ═══════════════════════════════════════════════════════════════
// EXTRACCIÓN AUTOMÁTICA DEL ESTADO DE LA PACIENTE
// Parsea el panel [ESTADO DE LA ASPIRANTE] del mensaje del modelo
// ═══════════════════════════════════════════════════════════════

function extraerEstadoPaciente(texto) {
    const updates = {};

    // Acepta "Progreso de la Carrera", "Progreso del Sueño", o "Sesión Nº X"
    const progressMatch = texto.match(/Progreso de la Carrera[^:]*:\*?\*?\s*(\d+)%/i);
    if (progressMatch) updates.progresoCarrera = parseInt(progressMatch[1]);

    // Para el psicólogo, usar número de sesión como progreso
    const sesionMatch = texto.match(/\*?\*?Sesi[oó]n N[ºo°\.][^:]*:\*?\*?\s*(\d+)/i);
    if (sesionMatch) updates.sesionNumero = parseInt(sesionMatch[1]);

    // Acepta formato psicólogo: "**Dependencia Terapéutica:** X%"
    const depMatch = texto.match(/Dependencia (?:del Agente|Terap[eé]utica)[^:]*:\*?\*?\s*(\d+)%/i);
    if (depMatch) updates.dependencia = parseInt(depMatch[1]);

    // También capturar Atadura (para Azrael) y otros formatos
    const ataduraMatch = texto.match(/Atadura a Azrael[^:]*:\*?\*?\s*(\d+)%/i);
    if (ataduraMatch) updates.dependencia = parseInt(ataduraMatch[1]);

    const soñoMatch = texto.match(/Progreso del Sue[ñn]o[^:]*:\*?\*?\s*(\d+)%/i);
    if (soñoMatch) updates.progresoCarrera = parseInt(soñoMatch[1]);

    // Umbral de pudor → inferir resistencia
    const pudorMatch = texto.match(/Umbral de Pudor[^:\|]*[\:\|]\s*([^\n\|\*]+)/i);
    if (pudorMatch) {
        const pudor = pudorMatch[1].trim().toLowerCase();
        if (pudor.includes('roto')) updates.resistencia = 15;
        else if (pudor.includes('vacil')) updates.resistencia = 45;
        else if (pudor.includes('estricto')) updates.resistencia = 85;
    }

    // Nombre detectado en la ficha
    const nombreMatch = texto.match(/(?:Nombre y Edad|Nombre)[^:\n]*[:\-–—]\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)/);
    if (nombreMatch) updates.nombreDetectado = nombreMatch[1].trim();

    return updates;
}

// ═══════════════════════════════════════════════════════════════
// CREAR / ACTUALIZAR PACIENTE
// ═══════════════════════════════════════════════════════════════

function determinarCategoria(edad, texto) {
    const t = texto.toLowerCase();
    // Indicadores explícitos
    if (t.includes('madre') || t.includes('familiar') || t.includes('tutora') ||
        t.includes('hijo') || t.includes('hija')) return 'madre_familiar';
    if (t.includes('influencer') || t.includes('modelo') || t.includes('ejecutiva') ||
        t.includes('vip') || t.includes('celebridad') || t.includes('actriz')) return 'vip';
    // Por edad
    if (edad >= 28) return 'madre_familiar';
    return 'estudiante';
}

function nuevaPaciente(datos) {
    const settings = getSettings();
    const state = getChatState();
    if (!state) return;

    const paciente = {
        id: `pac_${Date.now()}`,
        nombre: datos.nombre || 'Desconocida',
        edad: datos.edad || 25,
        categoria: datos.categoria || 'estudiante',
        psicologia: datos.psicologia || 'Quebradiza',
        postura: datos.postura || 'Inexperta',
        motivoConsulta: datos.motivoConsulta || '',
        crisis: datos.crisis || '',
        sesionNumero: 1,
        resistencia: 80,
        dependencia: 0,
        vulnerabilidad: 20,
        progresoCarrera: 0,
        notas: '',
        creadaEn: Date.now(),
    };

    state.paciente = paciente;
    state.sesionNumero = 1;
    state.vocesGeneradas = null;

    // Archivar en historial global de la extensión
    settings.totalPacientes++;
    settings.totalSesiones++;
    saveSettings();
    saveChatState();
}

function actualizarEstadoPaciente(updates) {
    const state = getChatState();
    if (!state?.paciente) return;

    if (updates.sesionNumero && updates.sesionNumero > state.paciente.sesionNumero) {
        state.paciente.sesionNumero = updates.sesionNumero;
        delete updates.sesionNumero;
        const settings = getSettings();
        settings.totalSesiones++;
        saveSettings();
    }

    Object.assign(state.paciente, updates);

    // Sumar reputación según progreso
    if (updates.dependencia >= 80 || updates.progresoCarrera >= 80) {
        const settings = getSettings();
        settings.reputacion = Math.min(100, settings.reputacion + 3);
        saveSettings();
    }

    saveChatState();
}

// ═══════════════════════════════════════════════════════════════
// RENDER — PANEL PRINCIPAL
// ═══════════════════════════════════════════════════════════════

function renderPanel() {
    renderDossier();
    renderArchivo();
    renderReputacion();
}

function renderDossier() {
    const state = getChatState();
    const container = document.getElementById('gabinete-tab-dossier');
    if (!container) return;

    const p = state?.paciente;

    if (!p) {
        container.innerHTML = `
            <div class="gabinete-empty">
                SIN PACIENTE ACTIVA<br><br>
                Inicia una sesión con la plantilla de la Agencia<br>
                para activar el expediente.
            </div>
            <button class="gabinete-btn secondary" id="gabinete-btn-nueva">
                + Nueva paciente manual
            </button>`;
        document.getElementById('gabinete-btn-nueva')?.addEventListener('click', abrirModalNuevaPaciente);
        return;
    }

    container.innerHTML = `
        <div class="gabinete-dossier-header">
            <div class="gabinete-patient-name">${p.nombre}</div>
            <div class="gabinete-patient-meta">
                <span>${p.edad} años</span>
                <span>${p.categoria.toUpperCase()}</span>
                <span>Sesión #${p.sesionNumero}</span>
                <span>${p.postura}</span>
            </div>
            <div class="gabinete-patient-meta" style="margin-top:4px;font-style:italic;color:#8b6914;">
                ${p.motivoConsulta || ''}
            </div>
        </div>

        <div class="gabinete-bars">
            <div class="gabinete-bar-row">
                <div class="gabinete-bar-label">Resistencia</div>
                <div class="gabinete-bar-track">
                    <div class="gabinete-bar-fill resistencia" style="width:${p.resistencia}%"></div>
                </div>
                <div class="gabinete-bar-value">${p.resistencia}%</div>
            </div>
            <div class="gabinete-bar-row">
                <div class="gabinete-bar-label">Dependencia</div>
                <div class="gabinete-bar-track">
                    <div class="gabinete-bar-fill dependencia" style="width:${p.dependencia}%"></div>
                </div>
                <div class="gabinete-bar-value">${p.dependencia}%</div>
            </div>
            <div class="gabinete-bar-row">
                <div class="gabinete-bar-label">Vulnerabilidad</div>
                <div class="gabinete-bar-track">
                    <div class="gabinete-bar-fill vulnerabilidad" style="width:${p.vulnerabilidad}%"></div>
                </div>
                <div class="gabinete-bar-value">${p.vulnerabilidad}%</div>
            </div>
        </div>

        <div class="gabinete-voices-section">
            <div class="gabinete-voices-title">Voces internas</div>
            <div id="gabinete-voices-container"></div>
            <button class="gabinete-btn" id="gabinete-btn-voces">
                ↺ Consultar voces
            </button>
        </div>

        <hr class="gabinete-divider">

        <div class="gabinete-session-notes">
            <div class="gabinete-voices-title">Notas de sesión</div>
            <textarea class="gabinete-notes-area" id="gabinete-notas"
                placeholder="Observaciones clínicas...">${state.notasSesion || ''}</textarea>
            <button class="gabinete-btn secondary" id="gabinete-btn-guardar-notas">
                Guardar notas
            </button>
        </div>`;

    renderVoces();

    document.getElementById('gabinete-btn-voces')?.addEventListener('click', () => {
        const lastMsg = getLastAssistantMessage();
        generarVoces(p, lastMsg);
    });

    document.getElementById('gabinete-btn-guardar-notas')?.addEventListener('click', () => {
        const val = document.getElementById('gabinete-notas')?.value || '';
        const s = getChatState();
        if (s) { s.notasSesion = val; saveChatState(); }
        showToast('Notas guardadas');
    });
}

function renderVoces() {
    const container = document.getElementById('gabinete-voices-container');
    if (!container) return;

    const state = getChatState();

    if (state?.vocesGenerandose) {
        container.innerHTML = '<div class="gabinete-generating">El terapeuta reflexiona</div>';
        return;
    }

    if (!state?.vocesGeneradas) {
        container.innerHTML = '<div class="gabinete-empty" style="padding:8px;">Sin análisis todavía.</div>';
        return;
    }

    container.innerHTML = VOCES.map(v => `
        <div class="gabinete-voice-card ${v.clase}">
            <div class="gabinete-voice-name">${v.nombre}</div>
            <div class="gabinete-voice-text">${state.vocesGeneradas[v.id] || '...'}</div>
        </div>`).join('');
}

function renderArchivo() {
    const container = document.getElementById('gabinete-tab-archivo');
    if (!container) return;
    const settings = getSettings();
    const state = getChatState();
    const activaId = state?.paciente?.id;

    let html = '';

    for (const cat of CATEGORIAS) {
        const unlocked = isUnlocked(cat.unlock);
        html += `<div class="gabinete-archive-category">
            <div class="gabinete-category-header">
                <div class="gabinete-category-title">${cat.label}</div>
            </div>`;

        if (!unlocked) {
            const unlock = UNLOCKS.find(u => u.id === cat.unlock);
            html += `<div class="gabinete-category-locked">
                <span class="lock-icon">🔒</span>
                <span>Requiere ${unlock?.req || '?'} pts de reputación — actual: ${settings.reputacion}</span>
            </div>`;
        } else {
            // Buscar pacientes de esta categoría en el historial global (guardadas en settings)
            const pacientes = (settings.archivoPacientes || []).filter(p => p.categoria === cat.id);
            if (pacientes.length === 0) {
                html += `<div class="gabinete-empty" style="padding:8px;font-size:10px;">Sin expedientes archivados.</div>`;
            } else {
                for (const p of pacientes) {
                    html += `
                    <div class="gabinete-patient-card ${p.id === activaId ? 'active-patient' : ''}"
                         data-id="${p.id}">
                        <div class="gabinete-card-info">
                            <div class="gabinete-card-name">${p.nombre}, ${p.edad}</div>
                            <div class="gabinete-card-meta">${p.psicologia} · ${p.postura}</div>
                            <div class="gabinete-card-meta" style="color:#8b6914;">${p.motivoConsulta || ''}</div>
                        </div>
                        <div class="gabinete-card-session">Ses. #${p.sesionNumero}</div>
                    </div>`;
                }
            }
        }
        html += '</div>';
    }

    container.innerHTML = html;
}

function renderReputacion() {
    const container = document.getElementById('gabinete-tab-reputacion');
    if (!container) return;
    const settings = getSettings();

    const unlockHtml = UNLOCKS.map(u => {
        const ok = settings.reputacion >= u.req;
        return `<div class="gabinete-unlock-item ${ok ? 'unlocked' : 'locked'}">
            <span class="gabinete-unlock-icon">${ok ? '✓' : u.icon}</span>
            <div>
                <div style="font-weight:bold;font-size:11px;">${u.label}</div>
                <div style="font-size:10px;margin-top:2px;">${u.desc}</div>
                ${!ok ? `<div style="font-size:9px;letter-spacing:1px;margin-top:2px;">Requiere ${u.req} pts</div>` : ''}
            </div>
        </div>`;
    }).join('');

    container.innerHTML = `
        <div class="gabinete-rep-block">
            <div class="gabinete-rep-title">Índice de Reputación</div>
            <div class="gabinete-rep-value">${settings.reputacion} pts</div>
            <div class="gabinete-rep-sub">${settings.totalPacientes} pacientes atendidas · ${settings.totalSesiones} sesiones totales</div>
        </div>
        <div class="gabinete-unlock-list">${unlockHtml}</div>`;
}

function renderSettings() {
    const container = document.getElementById('gabinete-tab-ajustes');
    if (!container) return;
    const settings = getSettings();

    container.innerHTML = `
        <div class="gabinete-settings-section">
            <div class="gabinete-settings-title">Configuración</div>
            <div class="gabinete-field">
                <label>Auto-analizar al recibir mensaje</label>
                <select id="gabinete-auto-analyze">
                    <option value="1" ${settings.autoAnalyze ? 'selected' : ''}>Activado</option>
                    <option value="0" ${!settings.autoAnalyze ? 'selected' : ''}>Desactivado</option>
                </select>
            </div>
        </div>
        <div class="gabinete-settings-section">
            <div class="gabinete-settings-title">Ajuste manual de reputación</div>
            <div class="gabinete-field">
                <label>Reputación actual (0–100)</label>
                <input type="number" id="gabinete-rep-manual" min="0" max="100" value="${settings.reputacion}">
            </div>
            <button class="gabinete-btn secondary" id="gabinete-btn-save-settings">Guardar</button>
        </div>
        <div class="gabinete-settings-section">
            <div class="gabinete-settings-title">Datos</div>
            <button class="gabinete-btn secondary" id="gabinete-btn-reset-chat">Reiniciar estado del chat</button>
        </div>
        <div style="font-size:9px;letter-spacing:1px;color:#8b6914;margin-top:12px;text-align:center;">
            El Gabinete v${VERSION}
        </div>`;

    document.getElementById('gabinete-btn-save-settings')?.addEventListener('click', () => {
        const auto = document.getElementById('gabinete-auto-analyze')?.value === '1';
        const rep = parseInt(document.getElementById('gabinete-rep-manual')?.value || '0');
        const s = getSettings();
        s.autoAnalyze = auto;
        s.reputacion = Math.max(0, Math.min(100, rep));
        saveSettings();
        renderPanel();
        showToast('Configuración guardada');
    });

    document.getElementById('gabinete-btn-reset-chat')?.addEventListener('click', () => {
        const meta = getChatMeta();
        if (meta) { delete meta[EXT_ID]; saveChatState(); }
        renderPanel();
        showToast('Estado del chat reiniciado');
    });
}

// ═══════════════════════════════════════════════════════════════
// MODAL: NUEVA PACIENTE MANUAL
// ═══════════════════════════════════════════════════════════════

function abrirModalNuevaPaciente() {
    const existing = document.getElementById('gabinete-modal');
    if (existing) existing.remove();

    const catOptions = CATEGORIAS
        .filter(c => isUnlocked(c.unlock))
        .map(c => `<option value="${c.id}">${c.label}</option>`)
        .join('');

    const modal = document.createElement('div');
    modal.id = 'gabinete-modal';
    modal.style.cssText = `
        position:fixed;inset:0;z-index:9200;
        background:rgba(0,0,0,0.7);
        display:flex;align-items:center;justify-content:center;
        padding:16px;`;

    modal.innerHTML = `
        <div style="background:#f5ead0;border:2px solid #8b6914;padding:20px;
                    max-width:420px;width:100%;font-family:'Courier New',monospace;">
            <div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;
                        color:#8b6914;margin-bottom:14px;">Nueva Paciente</div>

            <div class="gabinete-field"><label>Nombre</label>
                <input type="text" id="gm-nombre" placeholder="Nombre completo"></div>
            <div class="gabinete-field"><label>Edad</label>
                <input type="number" id="gm-edad" min="18" max="50" value="25"></div>
            <div class="gabinete-field"><label>Categoría</label>
                <select id="gm-cat">${catOptions}</select></div>
            <div class="gabinete-field"><label>Psicología base</label>
                <select id="gm-psico">
                    <option>Inquebrantable</option>
                    <option>Quebradiza</option>
                    <option>Obsesiva</option>
                </select></div>
            <div class="gabinete-field"><label>Postura inicial</label>
                <select id="gm-postura">
                    <option>Inexperta</option>
                    <option>Informada</option>
                    <option>Directa</option>
                </select></div>
            <div class="gabinete-field"><label>Motivo de consulta</label>
                <input type="text" id="gm-motivo" placeholder="Breve descripción"></div>
            <div class="gabinete-field"><label>Crisis / Secreto</label>
                <input type="text" id="gm-crisis" placeholder="La razón real por la que está aquí"></div>

            <div style="display:flex;gap:8px;margin-top:14px;">
                <button class="gabinete-btn" id="gm-guardar">Crear expediente</button>
                <button class="gabinete-btn secondary" id="gm-cancelar">Cancelar</button>
            </div>
        </div>`;

    document.body.appendChild(modal);

    document.getElementById('gm-cancelar').addEventListener('click', () => modal.remove());
    document.getElementById('gm-guardar').addEventListener('click', () => {
        const datos = {
            nombre: document.getElementById('gm-nombre').value.trim() || 'Anónima',
            edad: parseInt(document.getElementById('gm-edad').value) || 25,
            categoria: document.getElementById('gm-cat').value,
            psicologia: document.getElementById('gm-psico').value,
            postura: document.getElementById('gm-postura').value,
            motivoConsulta: document.getElementById('gm-motivo').value.trim(),
            crisis: document.getElementById('gm-crisis').value.trim(),
        };
        nuevaPaciente(datos);
        archivarPacienteEnSettings(getChatState()?.paciente);
        renderPanel();
        modal.remove();
        showToast(`Expediente creado: ${datos.nombre}`);
    });
}

function archivarPacienteEnSettings(p) {
    if (!p) return;
    const settings = getSettings();
    if (!settings.archivoPacientes) settings.archivoPacientes = [];
    const idx = settings.archivoPacientes.findIndex(x => x.id === p.id);
    if (idx >= 0) settings.archivoPacientes[idx] = p;
    else settings.archivoPacientes.unshift(p);
    saveSettings();
}

// ═══════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════

function getLastAssistantMessage() {
    const ctx = getContext();
    if (!ctx?.chat?.length) return '';
    const msgs = [...ctx.chat].reverse();
    const last = msgs.find(m => m.is_user === false || m.role === 'assistant');
    return last?.mes || last?.content || '';
}

let toastTimeout = null;
function showToast(msg) {
    let toast = document.getElementById('gabinete-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'gabinete-toast';
        toast.className = 'gabinete-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.remove('show'), 2500);
}

// ═══════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DEL DOM DEL PANEL
// ═══════════════════════════════════════════════════════════════

function buildPanelHTML() {
    return `
    <div id="gabinete-panel">
        <div id="gabinete-header">
            <h2>⚕ El Gabinete</h2>
            <button id="gabinete-close-btn" title="Cerrar">✕</button>
        </div>
        <div id="gabinete-tabs">
            <button class="gabinete-tab active" data-tab="dossier">Dossier</button>
            <button class="gabinete-tab" data-tab="archivo">Archivo</button>
            <button class="gabinete-tab" data-tab="reputacion">Rep.</button>
            <button class="gabinete-tab" data-tab="ajustes">Ajustes</button>
        </div>
        <div id="gabinete-content">
            <div id="gabinete-tab-dossier" class="gabinete-section active"></div>
            <div id="gabinete-tab-archivo" class="gabinete-section"></div>
            <div id="gabinete-tab-reputacion" class="gabinete-section"></div>
            <div id="gabinete-tab-ajustes" class="gabinete-section"></div>
        </div>
    </div>`;
}

function initDOM() {
    // FAB
    if (!document.getElementById('gabinete-fab')) {
        const fab = document.createElement('button');
        fab.id = 'gabinete-fab';
        fab.title = 'El Gabinete';
        fab.textContent = '⚕';
        document.body.appendChild(fab);
    }

    // Panel
    if (!document.getElementById('gabinete-panel')) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildPanelHTML();
        document.body.appendChild(wrapper.firstElementChild);
    }

    // FAB click
    document.getElementById('gabinete-fab').addEventListener('click', togglePanel);

    // Close btn
    document.getElementById('gabinete-close-btn').addEventListener('click', closePanel);

    // Tabs
    document.querySelectorAll('.gabinete-tab').forEach(tab => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
}

let panelOpen = false;

function togglePanel() {
    panelOpen ? closePanel() : openPanel();
}

function openPanel() {
    document.getElementById('gabinete-panel')?.classList.add('open');
    panelOpen = true;
    renderPanel();
    renderSettings();
}

function closePanel() {
    document.getElementById('gabinete-panel')?.classList.remove('open');
    panelOpen = false;
}

function switchTab(tabId) {
    document.querySelectorAll('.gabinete-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabId);
    });
    document.querySelectorAll('.gabinete-section').forEach(s => {
        s.classList.toggle('active', s.id === `gabinete-tab-${tabId}`);
    });

    if (tabId === 'archivo') renderArchivo();
    if (tabId === 'reputacion') renderReputacion();
    if (tabId === 'ajustes') renderSettings();
}

// ═══════════════════════════════════════════════════════════════
// HOOKS DE SILLYTAVERN
// ═══════════════════════════════════════════════════════════════

function onMessageReceived(data) {
    // ST puede pasar el objeto mensaje o solo el índice — extraer texto de ambas formas
    let texto = '';
    if (typeof data === 'string') {
        texto = data;
    } else if (data?.mes) {
        texto = data.mes;
    } else if (data?.message) {
        texto = data.message;
    } else {
        // Fallback: leer el último mensaje del chat directamente
        texto = getLastAssistantMessage();
    }
    if (!texto) return;

    // Intentar detectar ficha de nueva paciente — formato flexible
    const tieneFicha = texto.includes('FICHA DE LA ASPIRANTE') ||
                       texto.includes('FICHA DE LA CANDIDATA') ||
                       texto.includes('FICHA DE LA CAMPEONA') ||
                       texto.includes('FICHA DE LA PACIENTE') ||
                       texto.includes('FICHA DEL PACIENTE');

    if (tieneFicha) {
        // Nombre — acepta: "Aurora (28 años)", "Aurora, 28", "Aurora — 28 años"
        const nombreM = texto.match(/(?:Nombre y Edad|Nombre)[^:\n]*[:\-–—]\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)/);
        // Edad — buscar número entre 18 y 55 cerca del nombre
        const edadM = texto.match(/(?:Nombre y Edad)[^\n]*?(\d{2})\s*(?:años|a[ñn])/i)
                   || texto.match(/\b(1[89]|[2-4]\d|5[0-5])\s*años/i);
        const psicM = texto.match(/(?:Psicolog[ií]a Base)[^:\n]*[:\-–—]\s*([^\n•\-]+)/i);
        const posturaM = texto.match(/(?:Postura de Entrada)[^:\n]*[:\-–—]\s*([^\n•\-]+)/i);
        const contratoM = texto.match(/(?:Tipo de Contrato[^:\n]*)[:\-–—]\s*([^\n•\-]+)/i);
        const motivoM = texto.match(/(?:Sueño de la Carne|Ambici[oó]n|Crisis)[^:\n]*[:\-–—]\s*([^\n]+)/i);

        const datos = {
            nombre: nombreM?.[1]?.trim() || 'Desconocida',
            edad: parseInt(edadM?.[1]) || 25,
            psicologia: psicM?.[1]?.trim().replace(/\s*[\(\[].*/, '') || 'Quebradiza',
            postura: posturaM?.[1]?.trim().replace(/\s*[\(\[].*/, '') || 'Inexperta',
            motivoConsulta: contratoM?.[1]?.trim() || motivoM?.[1]?.trim() || '',
            crisis: motivoM?.[1]?.trim() || '',
            categoria: determinarCategoria(parseInt(edadM?.[1]) || 25, texto),
        };

        nuevaPaciente(datos);
        archivarPacienteEnSettings(getChatState()?.paciente);

        const fab = document.getElementById('gabinete-fab');
        fab?.classList.add('pulsing');
        setTimeout(() => fab?.classList.remove('pulsing'), 4000);
        showToast(`Nueva paciente: ${datos.nombre}`);
    }

    // Extraer actualizaciones de estado
    const updates = extraerEstadoPaciente(texto);
    if (Object.keys(updates).length > 0) {
        if (updates.nombreDetectado) {
            const state = getChatState();
            if (state?.paciente && state.paciente.nombre === 'Desconocida') {
                state.paciente.nombre = updates.nombreDetectado;
            }
            delete updates.nombreDetectado;
        }
        actualizarEstadoPaciente(updates);
        archivarPacienteEnSettings(getChatState()?.paciente);
    }

    // Auto-voces si está desbloqueado y activado
    const settings = getSettings();
    if (settings.autoAnalyze && isUnlocked('voces_auto')) {
        const state = getChatState();
        if (state?.paciente) {
            generarVoces(state.paciente, texto.slice(0, 400));
        }
    }

    if (panelOpen) renderPanel();
}

function onChatChanged() {
    if (panelOpen) renderPanel();
}

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════

(function init() {
    initDOM();

    // Inicializar settings globales
    if (!extension_settings[EXT_ID]) {
        extension_settings[EXT_ID] = getDefaultSettings();
        saveSettings();
    }

    // Suscribirse a eventos de SillyTavern
    if (eventSource) {
        // Usar nombres string como fallback por si event_types no tiene la key exacta
        const msgEvent = event_types?.MESSAGE_RECEIVED || 'message_received';
        const chatEvent = event_types?.CHAT_CHANGED || 'chat_id_changed';
        const charEvent = event_types?.CHARACTER_SELECTED || 'character_selected';

        eventSource.on(msgEvent, (data) => onMessageReceived(data));
        eventSource.on(chatEvent, onChatChanged);
        eventSource.on(charEvent, onChatChanged);

        // También escuchar MESSAGE_SENT por si acaso el modelo responde vía streaming
        const streamEvent = event_types?.STREAM_TOKEN_RECEIVED || 'stream_token_received';
        // No suscribir streaming — demasiado frecuente. Solo mensaje completo.

        console.log('[El Gabinete] Eventos registrados:', msgEvent, chatEvent);
    } else {
        console.warn('[El Gabinete] eventSource no disponible — usando MutationObserver');
        const observer = new MutationObserver(() => {
            const lastMsg = getLastAssistantMessage();
            if (lastMsg) onMessageReceived({ mes: lastMsg });
        });
        const chat = document.getElementById('chat');
        if (chat) observer.observe(chat, { childList: true, subtree: false });
    }

    console.log(`[El Gabinete] v${VERSION} cargado`);
})();
