const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses')

const ses = new SESClient({ region: 'us-east-1' })

exports.handler = async (event) => {
  for (const record of event.Records) {
    const { email, titulo, noteId, esInvitado } = JSON.parse(record.body)

    if (esInvitado) {
      console.log(`[SIMULADO] Email NO enviado a invitado (${email}) para nota ${noteId} — "${titulo}"`)
      continue
    }

    await ses.send(new SendEmailCommand({
      Source: 'natanaelhuenullan6@gmail.com',
      Destination: {
        ToAddresses: [email]
      },
      Message: {
        Subject: {
          Data: 'Nueva nota creada'
        },
        Body: {
          Text: {
            Data: `Hola, creaste la nota "${titulo}" exitosamente.\n\nID de la nota: ${noteId}`
          }
        }
      }
    }))

    console.log(`Email enviado a ${email} para nota ${noteId}`)
  }
}