const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses')

const ses = new SESClient({ region: 'us-east-1' })

const formatearResumenInvitado = (userId, notas) => {
  const detalleNotas = notas.map((nota, indice) => [
    `Nota ${indice + 1}: ${nota.titulo}`,
    `ID: ${nota.noteId}`,
    `Creada: ${nota.creadoEn}`,
    ...(nota.actualizadoEn ? [`Actualizada: ${nota.actualizadoEn}`] : []),
    '',
    nota.cuerpo,
  ].join('\n')).join('\n\n------------------------------\n\n')

  return [
    `Resumen del invitado expirado: ${userId}`,
    `Cantidad de notas activas: ${notas.length}`,
    '',
    detalleNotas,
  ].join('\n')
}

exports.handler = async (event) => {
  for (const record of event.Records) {
    const mensaje = JSON.parse(record.body)

    if (mensaje.tipo !== 'resumen_invitado') {
      throw new Error(`Tipo de mensaje no soportado: ${mensaje.tipo || 'sin tipo'}`)
    }

    await ses.send(new SendEmailCommand({
      Source: 'natanaelhuenullan6@gmail.com',
      Destination: {
        ToAddresses: [mensaje.email]
      },
      Message: {
        Subject: {
          Data: 'Resumen de notas de invitado expirado'
        },
        Body: {
          Text: {
            Data: formatearResumenInvitado(mensaje.userId, mensaje.notas)
          }
        }
      }
    }))

    console.log(
      `Resumen enviado a ${mensaje.email} para invitado ${mensaje.userId} (${mensaje.notas.length} notas)`,
    )
  }
}
