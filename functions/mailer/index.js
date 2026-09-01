const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses')

const ses = new SESClient({ region: 'us-east-1' })

/* ------------------------------------------------------------------------- */
/* FORMATEO COMPARTIDO                                                       */
/* ------------------------------------------------------------------------- */

const formatearDetalleNotas = (notas) =>
  notas.map((nota, indice) => [
    `Nota ${indice + 1}: ${nota.titulo}`,
    `ID: ${nota.noteId}`,
    `Creada: ${nota.creadoEn}`,
    ...(nota.actualizadoEn ? [`Actualizada: ${nota.actualizadoEn}`] : []),
    '',
    nota.cuerpo,
  ].join('\n')).join('\n\n------------------------------\n\n')

/* ------------------------------------------------------------------------- */
/* USUARIOS INVITADOS                                                        */
/* ------------------------------------------------------------------------- */

const formatearResumenInvitado = (userId, notas) => {
  return [
    `Resumen del invitado expirado: ${userId}`,
    `Cantidad de notas activas: ${notas.length}`,
    '',
    formatearDetalleNotas(notas),
  ].join('\n')
}

/* ------------------------------------------------------------------------- */
/* USUARIOS REALES                                                           */
/* ------------------------------------------------------------------------- */

const formatearResumenUsuario = (userId, notas) => {
  return [
    `Resumen semanal del usuario: ${userId}`,
    `Cantidad de notas activas: ${notas.length}`,
    '',
    formatearDetalleNotas(notas),
  ].join('\n')
}

exports.handler = async (event) => {
  for (const record of event.Records) {
    const mensaje = JSON.parse(record.body)
    let asunto
    let cuerpo
    let descripcionLog

    if (mensaje.tipo === 'resumen_invitado') {
      asunto = 'Resumen de notas de invitado expirado'
      cuerpo = formatearResumenInvitado(mensaje.userId, mensaje.notas)
      descripcionLog = `invitado ${mensaje.userId}`
    } else if (mensaje.tipo === 'resumen_usuario') {
      asunto = 'Auditoría semanal de notas de usuario'
      cuerpo = formatearResumenUsuario(mensaje.userId, mensaje.notas)
      descripcionLog = `usuario ${mensaje.userId}`
    } else {
      throw new Error(`Tipo de mensaje no soportado: ${mensaje.tipo || 'sin tipo'}`)
    }

    await ses.send(new SendEmailCommand({
      Source: 'natanaelhuenullan6@gmail.com',
      Destination: {
        ToAddresses: [mensaje.email]
      },
      Message: {
        Subject: {
          Data: asunto
        },
        Body: {
          Text: {
            Data: cuerpo
          }
        }
      }
    }))

    console.log(
      `Resumen enviado a ${mensaje.email} para ${descripcionLog} (${mensaje.notas.length} notas)`,
    )
  }
}
