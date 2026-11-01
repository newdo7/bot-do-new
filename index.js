const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  Browsers,
} = require('@whiskeysockets/baileys')
const pino = require('pino')

const PREFIX = '!'
const NUMBER = (process.env.BOT_NUMBER || '').replace(/\D/g, '')
const AUTH_DIR = process.env.AUTH_DIR || 'auth'

const antilinkGroups = new Set()
const rand = (n) => Math.floor(Math.random() * n)
const tag = (jid) => '@' + jid.split('@')[0]

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: Browsers.ubuntu('Chrome'),
    printQRInTerminal: false,
  })

  if (!sock.authState.creds.registered) {
    if (!NUMBER) {
      console.log('Defina a variável BOT_NUMBER (ex: 5511999999999)')
      process.exit(1)
    }
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(NUMBER)
        console.log('=== CÓDIGO DE PAREAMENTO: ' + code + ' ===')
      } catch (e) {
        console.log('Erro ao pedir código:', e.message)
      }
    }, 3000)
  }

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') console.log('Bot online!')
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode
      if (status !== DisconnectReason.loggedOut) start()
      else console.log('Deslogado. Apague a pasta de sessão e reinicie.')
    }
  })

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    const m = messages[0]
    if (!m?.message || m.key.fromMe) return

    const jid = m.key.remoteJid
    const isGroup = jid.endsWith('@g.us')
    const sender = m.key.participant || jid
    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      m.message.imageMessage?.caption ||
      ''

    const reply = (t, mentions = []) =>
      sock.sendMessage(jid, { text: t, mentions }, { quoted: m })

    let admins = []
    let isAdmin = false
    let botAdmin = false
    let participants = []
    if (isGroup) {
      const meta = await sock.groupMetadata(jid)
      participants = meta.participants
      admins = participants.filter((p) => p.admin).map((p) => p.id)
      isAdmin = admins.includes(sender)
      const botId = sock.user.id.split(':')[0] + '@s.whatsapp.net'
      botAdmin = admins.includes(botId)
    }

    if (isGroup && antilinkGroups.has(jid) && /(https?:\/\/|chat\.whatsapp\.com)/i.test(text)) {
      if (!isAdmin && botAdmin) {
        await sock.sendMessage(jid, { delete: m.key })
        await sock.groupParticipantsUpdate(jid, [sender], 'remove')
        return
      }
    }

    if (!text.startsWith(PREFIX)) return
    const [cmd, ...args] = text.slice(PREFIX.length).trim().split(/\s+/)
    const ctx = m.message.extendedTextMessage?.contextInfo || {}
    const target = (ctx.mentionedJid || [])[0] || ctx.participant

    const onlyGroup = async () => {
      if (!isGroup) await reply('Esse comando só funciona em grupo.')
      return isGroup
    }
    const needAdmin = async () => {
      if (!(await onlyGroup())) return false
      if (!isAdmin) { await reply('Só admin pode usar isso.'); return false }
      if (!botAdmin) { await reply('Me promove a admin primeiro.'); return false }
      return true
    }

    switch (cmd.toLowerCase()) {
      case 'menu':
      case 'help':
        return reply(
`*🤖 MENU*

*Brincadeiras*
${PREFIX}ping
${PREFIX}dado
${PREFIX}sorte
${PREFIX}par
${PREFIX}ship @a @b
${PREFIX}gay @pessoa
${PREFIX}sn pergunta

*Admin*
${PREFIX}marcar texto
${PREFIX}ban @pessoa
${PREFIX}promover @pessoa
${PREFIX}rebaixar @pessoa
${PREFIX}antilink on/off`)

      case 'ping':
        return reply('pong 🏓')

      case 'dado':
        return reply('🎲 Caiu: *' + (rand(6) + 1) + '*')

      case 'sorte':
        return reply('🍀 Sua sorte hoje: *' + rand(101) + '%*')

      case 'sn': {
        if (!args.length) return reply('Faz uma pergunta. Ex: ' + PREFIX + 'sn eu vou passar?')
        return reply(Math.random() < 0.5 ? '✅ Sim' : '❌ Não')
      }

      case 'gay': {
        const alvo = target || sender
        return reply(`🏳️‍🌈 ${tag(alvo)} é *${rand(101)}%* gay`, [alvo])
      }

      case 'par': {
        if (!(await onlyGroup())) return
        const ids = participants.map((p) => p.id)
        if (ids.length < 2) return reply('Grupo pequeno demais.')
        const a = ids.splice(rand(ids.length), 1)[0]
        const b = ids[rand(ids.length)]
        return reply(`💘 O par do momento: ${tag(a)} + ${tag(b)}`, [a, b])
      }

      case 'ship': {
        const ms = ctx.mentionedJid || []
        if (ms.length < 2) return reply('Marque duas pessoas. Ex: ' + PREFIX + 'ship @a @b')
        return reply(`💞 ${tag(ms[0])} + ${tag(ms[1])} = *${rand(101)}%*`, ms.slice(0, 2))
      }

      case 'marcar': {
        if (!(await onlyGroup())) return
        if (!isAdmin) return reply('Só admin pode usar isso.')
        const ids = participants.map((p) => p.id)
        const msg = args.join(' ') || '📢 Atenção, pessoal!'
        return sock.sendMessage(jid, { text: msg, mentions: ids })
      }

      case 'ban': {
        if (!(await needAdmin())) return
        if (!target) return reply('Marque ou responda a pessoa.')
        if (admins.includes(target)) return reply('Não dá para banir admin.')
        await sock.groupParticipantsUpdate(jid, [target], 'remove')
        return reply('🚫 Removido.')
      }

      case 'promover': {
        if (!(await needAdmin())) return
        if (!target) return reply('Marque ou responda a pessoa.')
        await sock.groupParticipantsUpdate(jid, [target], 'promote')
        return reply('⬆️ Promovido a admin.')
      }

      case 'rebaixar': {
        if (!(await needAdmin())) return
        if (!target) return reply('Marque ou responda a pessoa.')
        await sock.groupParticipantsUpdate(jid, [target], 'demote')
        return reply('⬇️ Admin removido.')
      }

      case 'antilink': {
        if (!(await needAdmin())) return
        const opt = (args[0] || '').toLowerCase()
        if (opt === 'on') { antilinkGroups.add(jid); return reply('🔗 Antilink ligado.') }
        if (opt === 'off') { antilinkGroups.delete(jid); return reply('🔗 Antilink desligado.') }
        return reply('Use: ' + PREFIX + 'antilink on ou off')
      }

      default:
        return
    }
  })
}

start()
