'use client'

import type { ReactNode } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export type LegalDoc = 'privacidad' | 'terminos'

interface LegalDialogProps {
  /** Documento a mostrar; `null` mantiene el dialog cerrado. */
  doc: LegalDoc | null
  onOpenChange: (open: boolean) => void
}

const CONTACTO = 'contacto@crm-albra.com'

function Seccion({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <h4 className="text-sm font-semibold text-slate-900">{titulo}</h4>
      <div className="space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </div>
  )
}

function ContactoFinal() {
  return (
    <p className="text-sm text-slate-600">
      ¿Preguntas sobre este documento? Escríbenos a{' '}
      <a href={`mailto:${CONTACTO}`} className="font-medium text-emerald-600 hover:text-emerald-700">
        {CONTACTO}
      </a>
      .
    </p>
  )
}

function PrivacidadContent() {
  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="text-xl font-bold text-slate-900">Política de Privacidad</DialogTitle>
        <DialogDescription className="text-sm">
          Resumen honesto de cómo tratamos los datos durante la beta privada. El texto completo
          se entregará por escrito al iniciar el piloto.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <Seccion titulo="Responsable del tratamiento">
          <p>
            Durante el piloto, CRM ALBRA opera el sistema y trata los datos como responsable,
            conforme a la Ley 1581 de 2012 de Colombia (régimen general de protección de datos
            personales) y la regulación de la Superintendencia de Industria y Comercio (SIC).
          </p>
        </Seccion>

        <Seccion titulo="Datos que tratamos">
          <p>
            Los que la empresa participante carga en el CRM y los que se generan al usarlo:
            nombres, teléfonos, conversaciones de mensajería, oportunidades, cotizaciones e
            información comercial asociada a sus clientes.
          </p>
        </Seccion>

        <Seccion titulo="Finalidad">
          <p>
            Usamos estos datos exclusivamente para prestar el servicio del CRM: registrar
            interacciones, responder mensajes con el agente de IA, avanzar oportunidades,
            generar cotizaciones y reportes. No vendemos ni cedemos datos personales a terceros
            con fines publicitarios.
          </p>
        </Seccion>

        <Seccion titulo="Mensajería e inteligencia artificial">
          <p>
            Los envíos por WhatsApp, Telegram e Instagram salen de las cuentas de la empresa
            participante, que es responsable de contar con la autorización de sus destinatarios
            y de cumplir los términos de esas plataformas. El agente de IA procesa el contenido
            de las conversaciones para responder, clasificar y sugerir acciones comerciales.
          </p>
        </Seccion>

        <Seccion titulo="Seguridad">
          <p>
            Los secretos y credenciales del sistema (tokens de conexión, llaves) se almacenan
            cifrados en reposo. Los datos de cada organización están aislados y el acceso está
            restringido al personal que participa en el piloto.
          </p>
        </Seccion>

        <Seccion titulo="Tus derechos (habeas data)">
          <p>
            Puedes solicitar en cualquier momento el acceso, la actualización, la rectificación
            y la supresión de tus datos personales, así como revocar la autorización otorgada,
            escribiendo a {CONTACTO}. Responderemos dentro de los plazos de la ley.
          </p>
        </Seccion>

        <Seccion titulo="Cambios en esta política">
          <p>
            Si durante la beta cambia algo de lo descrito aquí, lo avisaremos con antelación y
            solicitaremos una nueva autorización cuando aplique.
          </p>
        </Seccion>

        <ContactoFinal />
      </div>
    </div>
  )
}

function TerminosContent() {
  return (
    <div className="space-y-5">
      <DialogHeader>
        <DialogTitle className="text-xl font-bold text-slate-900">Términos de Servicio</DialogTitle>
        <DialogDescription className="text-sm">
          Resumen honesto de las condiciones del servicio durante la beta privada. El texto
          completo se entregará por escrito al iniciar el piloto.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-5">
        <Seccion titulo="Naturaleza del servicio">
          <p>
            CRM ALBRA está en beta privada: un piloto controlado que se abre a una empresa a la
            vez. Las funciones pueden cambiar mientras validamos el producto. Durante esta etapa
            no ofrecemos SLA ni soporte 24/7 garantizado; sí acompañamiento directo del equipo.
          </p>
        </Seccion>

        <Seccion titulo="Cuenta demo">
          <p>
            Puedes crear una cuenta de prueba con datos de ejemplo, sin costo ni compromiso de
            permanencia. La demo existe para evaluar el producto y sus datos pueden depurarse
            periódicamente.
          </p>
        </Seccion>

        <Seccion titulo="Responsabilidad sobre los datos">
          <p>
            La empresa participante es responsable de la veracidad de los datos que carga y de
            contar con las autorizaciones necesarias de sus clientes para contactarlos. Cada
            organización opera con datos aislados.
          </p>
        </Seccion>

        <Seccion titulo="Uso aceptable">
          <p>
            No está permitido usar el sistema para envío masivo de mensajes no solicitados
            (spam) ni en contravención de los términos de WhatsApp, Telegram, Instagram o
            Google. El incumplimiento puede llevar a suspender el acceso al piloto.
          </p>
        </Seccion>

        <Seccion titulo="Disponibilidad y cambios">
          <p>
            Durante la beta el servicio puede presentar interrupciones o cambios de funciones.
            Avisaremos con antelación razonable los cambios que afecten el uso normal.
          </p>
        </Seccion>

        <Seccion titulo="Sin cargos automáticos">
          <p>
            Durante el piloto no se realizan cobros automáticos. Si en el futuro existieran
            planes de pago, el precio y el alcance se acordarán por escrito y requerirán tu
            consentimiento antes de aplicar.
          </p>
        </Seccion>

        <Seccion titulo="Propiedad y salida">
          <p>
            Los datos que la empresa participante registra son suyos. Puede exportarlos (PDF,
            Excel, CSV) y solicitar su eliminación al finalizar el piloto.
          </p>
        </Seccion>

        <ContactoFinal />
      </div>
    </div>
  )
}

export function LegalDialog({ doc, onOpenChange }: LegalDialogProps) {
  return (
    <Dialog open={doc !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {doc === 'terminos' ? <TerminosContent /> : <PrivacidadContent />}
      </DialogContent>
    </Dialog>
  )
}
