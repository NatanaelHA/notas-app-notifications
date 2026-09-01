# Notas App — Servicio de notificaciones

Backend serverless responsable del envío de notificaciones por correo de **Notas App**. Consume desde Amazon SQS los resúmenes de notas de invitados vencidos y usuarios reales, y utiliza Amazon SES para enviarlos al correo de auditoría.

Este repositorio forma parte de una arquitectura separada por servicios:

- [`notas-app-frontend`](https://github.com/NatanaelHA/notas-app-frontend): interfaz web.
- [`notas-app-backend`](https://github.com/NatanaelHA/notas-app-backend): notas, DynamoDB, S3 y publicación de resúmenes en SQS.
- [`notas-app-usuarios`](https://github.com/NatanaelHA/notas-app-usuarios): usuarios invitados y Cognito.
- [`notas-app-notifications`](https://github.com/NatanaelHA/notas-app-notifications): notificaciones por correo (este repositorio).

## Responsabilidades

Este servicio es responsable de:

- Consumir solicitudes de correo desde la cola SQS `notas-emails`.
- Validar mensajes de tipo `resumen_invitado` y `resumen_usuario`.
- Formatear las notas activas recopiladas antes de su eliminación.
- Enviar mediante SES el resumen del invitado al correo de auditoría.
- Enviar también el resumen semanal de usuarios reales al correo de auditoría.
- Permitir que SQS reintente los mensajes cuando el procesamiento falla.
- Trabajar con la cola de mensajes fallidos `notas-emails-fallidos` configurada como DLQ de la cola principal.

Este servicio **no** crea notas, administra usuarios ni expone endpoints HTTP.

## Arquitectura

```text
eliminarNotasInvitado                 eliminarNotasUsuario
    ↓ resumen_invitado                    ↓ resumen_usuario
              SQS (notas-emails)
                      ↓ activa la Lambda
              mailer, en notas-app-notifications
                      ↓ selecciona el formato
                  Amazon SES
                      ↓
               correo de auditoría
```

`mailer` no consulta DynamoDB ni llama al servicio de notas. Toda la información necesaria para generar el correo viaja dentro del mensaje de SQS.

## Manejo de errores

Si `mailer` procesa correctamente el mensaje, la integración de Lambda con SQS lo elimina de la cola.

```text
Procesamiento exitoso
→ SQS elimina el mensaje de notas-emails
```

Si el JSON es inválido, el tipo no es compatible o SES devuelve un error, la Lambda termina con error y SQS conserva el mensaje para volver a entregarlo después del tiempo de visibilidad.

```text
Procesamiento fallido
→ el mensaje vuelve a notas-emails
→ SQS lo entrega nuevamente
→ al superar maxReceiveCount
→ notas-emails-fallidos
```

- **CloudWatch Logs** conserva el motivo técnico del fallo de `mailer`.
- **SQS** muestra los mensajes pendientes o en vuelo.
- **notas-emails-fallidos** conserva los mensajes que agotaron sus intentos.

La política de redirección, el tiempo de visibilidad y `maxReceiveCount` están configurados directamente en AWS.

## Servicios AWS utilizados

| Servicio | Uso dentro de este backend |
|---|---|
| AWS Lambda | Ejecuta la función `mailer`. |
| Amazon SQS | Entrega solicitudes de correo y administra sus reintentos. |
| Amazon SES | Envía todos los resúmenes al correo de auditoría verificado. |
| Amazon CloudWatch | Registra logs y métricas de la Lambda. |

## Lambda

| Función | Activación | Descripción |
|---|---|---|
| `mailer` | Trigger de SQS | Procesa mensajes `resumen_invitado` y `resumen_usuario`, formatea las notas y solicita su envío a SES. |

Este backend no utiliza `response.js` porque la función no es invocada por API Gateway. El resultado se comunica de esta forma:

- Si termina sin lanzar errores, SQS considera procesado el mensaje.
- Si lanza un error, SQS conserva el mensaje para reintentarlo.

## Contrato de los mensajes SQS

El servicio de notas publica mensajes con esta estructura:

```json
{
  "tipo": "resumen_invitado",
  "userId": "sub-del-invitado",
  "email": "correo-de-auditoria-verificado-en-ses@ejemplo.com",
  "notas": [
    {
      "noteId": "id-de-la-nota",
      "titulo": "Título de la nota",
      "cuerpo": "Contenido",
      "creadoEn": "2026-08-25T02:14:32.687Z"
    }
  ]
}
```

Para usuarios reales se conserva la misma forma y cambia el tipo. El destinatario sigue siendo el correo de auditoría:

```json
{
  "tipo": "resumen_usuario",
  "userId": "sub-del-usuario",
  "email": "correo-de-auditoria-verificado-en-ses@ejemplo.com",
  "notas": [
    {
      "noteId": "id-de-la-nota",
      "titulo": "Título de la nota",
      "cuerpo": "Contenido",
      "creadoEn": "2026-08-25T02:14:32.687Z"
    }
  ]
}
```

`mailer` utiliza:

- `tipo`: selecciona el flujo `resumen_invitado` o `resumen_usuario`.
- `userId`: identifica al propietario de las notas en el cuerpo o en los logs.
- `email`: contiene el correo de auditoría verificado al que SES debe enviar el resumen.
- `notas`: contiene las notas activas recopiladas antes de eliminarlas de DynamoDB.

Un mensaje sin tipo o con un tipo no soportado provoca un error. De esta forma SQS puede reintentarlo y, si el problema persiste, conservarlo en `notas-emails-fallidos` en lugar de descartarlo silenciosamente.

## Correos enviados

### Resumen de invitado

- Asunto: `Resumen de notas de invitado expirado`.
- Destinatario: el correo de auditoría recibido desde SQS.
- Cantidad de notas activas.
- `userId` del invitado en el cuerpo del correo.
- Por cada nota: título, identificador, fecha de creación, fecha de actualización si existe y contenido.

### Resumen de usuario real

- Asunto: `Auditoría semanal de notas de usuario`.
- Destinatario: el correo de auditoría recibido desde SQS.
- Cantidad de notas activas.
- `userId` del usuario real en el cuerpo del correo.
- Por cada nota: título, identificador, fecha de creación, fecha de actualización si existe y contenido.

Los adjuntos y las URLs prefirmadas de S3 no forman parte del resumen actual.

El remitente y el correo de auditoría están verificados en la región `us-east-1`. Mientras SES permanezca en sandbox, los resúmenes no se envían a las direcciones particulares de los usuarios.

## Estructura del proyecto

```text
notas-app-notifications/
├── functions/
│   └── mailer/
│       └── index.js
├── .github/
│   └── workflows/
│       └── deploy.yml
├── package.json
└── package-lock.json
```

## Instalación local

Requisitos:

- Node.js 22.
- npm.

Instala las versiones registradas en `package-lock.json`:

```bash
npm ci
```

## CI/CD

El workflow `.github/workflows/deploy.yml` está configurado para ejecutarse con pushes a:

- `develop`, usando el environment de GitHub `development`.
- `main`, usando el environment de GitHub `production`.

El workflow instala dependencias, genera `lambda.zip` y actualiza el código de la Lambda existente `mailer` mediante AWS CLI.

Secrets requeridos por el workflow:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
```

> El workflow actualiza código existente. La creación de la Lambda, su trigger SQS, SES, las colas, la DLQ y los permisos se administra directamente en AWS.

## Consideración sobre lotes de SQS

SQS puede entregar varios mensajes en una misma invocación. El código actual los procesa secuencialmente y, si uno falla, la invocación completa termina con error. Dependiendo de la configuración del trigger, los mensajes anteriores del mismo lote podrían volver a procesarse.

Como mejora futura se puede habilitar el reporte de fallos parciales por lote para reintentar únicamente los mensajes que fallaron.
