# Notas App — Servicio de notificaciones

Backend serverless responsable del envío de notificaciones por correo de **Notas App**. Consume mensajes desde Amazon SQS y utiliza Amazon SES para enviar un correo cuando un usuario registrado crea una nota.

Este repositorio forma parte de una arquitectura separada por servicios:

- [`notas-app-frontend`](https://github.com/NatanaelHA/notas-app-frontend): interfaz web.
- [`notas-app-backend`](https://github.com/NatanaelHA/notas-app-backend): notas, DynamoDB, S3 y publicación de mensajes en SQS.
- [`notas-app-usuarios`](https://github.com/NatanaelHA/notas-app-usuarios): usuarios invitados y Cognito.
- [`notas-app-notifications`](https://github.com/NatanaelHA/notas-app-notifications): notificaciones por correo (este repositorio).

## Responsabilidades

Este servicio es responsable de:

- Consumir solicitudes de correo desde la cola SQS `notas-emails`.
- Ignorar el envío real para cuentas invitadas y registrar una simulación en CloudWatch.
- Enviar mediante SES un correo a los usuarios registrados cuando crean una nota.
- Permitir que SQS reintente los mensajes cuando el procesamiento falla.
- Trabajar con la cola de mensajes fallidos `notas-emails-fallidos` configurada como DLQ de la cola principal.

Este servicio **no** crea notas, administra usuarios ni expone endpoints HTTP.

## Arquitectura

```text
Frontend
    ↓ crea una nota
API Gateway
    ↓
crearNota, en notas-app-backend
    ↓ publica un mensaje
SQS (notas-emails)
    ↓ activa la Lambda
mailer, en notas-app-notifications
    ↓
SES
    ↓
Correo del usuario
```

`mailer` no consulta DynamoDB ni llama al servicio de notas. Toda la información necesaria para generar el correo viaja dentro del mensaje de SQS.

## Manejo de errores

Si `mailer` procesa correctamente el mensaje, la integración de Lambda con SQS lo elimina de la cola.

```text
Procesamiento exitoso
→ SQS elimina el mensaje de notas-emails
```

Si el JSON es inválido o SES devuelve un error, la Lambda termina con error y SQS conserva el mensaje para volver a entregarlo después del tiempo de visibilidad.

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
| Amazon SES | Realiza el envío del correo. |
| Amazon CloudWatch | Registra logs y métricas de la Lambda. |

## Lambda

| Función | Activación | Descripción |
|---|---|---|
| `mailer` | Trigger de SQS | Procesa mensajes de `notas-emails` y envía correos mediante SES. |

Este backend no utiliza `response.js` porque la función no es invocada por API Gateway. El resultado se comunica de esta forma:

- Si termina sin lanzar errores, SQS considera procesado el mensaje.
- Si lanza un error, SQS conserva el mensaje para reintentarlo.

## Contrato del mensaje SQS

El servicio de notas publica mensajes con esta estructura:

```json
{
  "userId": "sub-del-usuario",
  "email": "usuario@ejemplo.com",
  "titulo": "Título de la nota",
  "noteId": "id-de-la-nota",
  "esInvitado": false
}
```

`mailer` utiliza:

- `email`: destinatario del correo.
- `titulo`: título incluido en el cuerpo del mensaje.
- `noteId`: identificador incluido en el correo y los logs.
- `esInvitado`: evita enviar correos reales a cuentas temporales.

Actualmente `userId` forma parte del contrato, aunque `mailer` no lo utiliza directamente.

## Comportamiento para invitados

Si `esInvitado` es `true`, la función no llama a SES. Registra en CloudWatch:

```text
[SIMULADO] Email NO enviado a invitado (...)
```

El mensaje se considera procesado correctamente y SQS lo elimina de la cola.

## Correo enviado

Para usuarios registrados, el correo contiene:

- Asunto: `Nueva nota creada`.
- Destinatario: el correo recibido desde SQS.
- Contenido: título e identificador de la nota.

El remitente debe estar autorizado para enviar mediante SES en la región `us-east-1`.

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
