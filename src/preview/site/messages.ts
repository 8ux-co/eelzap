/**
 * The site tools' own words («Editar» and «Comentar», zap-cms-v2 §3.4), Spanish and English (Spanish by default, as
 * the suite; `<html lang="en…">` or `initZap({ locale: 'en' })` picks
 * English). Two objects, one per chunk, so each chunk carries only its own
 * copy. Plain strings and functions: the core has no i18n runtime, and these
 * never reach the server. Copy rules (`.docs/ui-patterns/copy.md`): no
 * ellipses, em dashes, middots or parentheses.
 */

type Locale = 'es' | 'en'

const plural = (count: number, one: string, other: string) =>
  (count === 1 ? one : other).replace('{n}', String(count))

export const SIGNIN_MESSAGES = {
  es: {
    launcher: 'Editar o comentar',
    hintBefore: 'Pulsa',
    hintAfter: 'para editar o comentar',
    title: 'Edita o comenta esta página',
    body: 'Escribe sobre el texto de la página o deja un comentario. Lo que edites queda en el borrador y se publica desde Zap.',
    signIn: 'Entrar con Eel',
    note: 'Solo para personas con Zap en este sitio. Los visitantes no ven nada de esto.',
    waiting: 'Esperando a Eel',
    waitingHelp: 'Termina en la ventana de Eel. Si la cerraste, vuelve a intentarlo.',
    retry: 'Intentar de nuevo',
    close: 'Cerrar',
    expired: 'Tu sesión terminó. Entra de nuevo para seguir.',
    failed: 'No pudimos completar la entrada. Intenta de nuevo.',
  },
  en: {
    launcher: 'Edit or comment',
    hintBefore: 'Press',
    hintAfter: 'to edit or comment',
    title: 'Edit or comment on this page',
    body: 'Type over the text on the page or leave a comment. What you edit goes to the draft and is published from Zap.',
    signIn: 'Sign in with Eel',
    note: 'Only for people with Zap on this site. Visitors see none of this.',
    waiting: 'Waiting for Eel',
    waitingHelp: 'Finish in the Eel window. If you closed it, try again.',
    retry: 'Try again',
    close: 'Close',
    expired: 'Your session ended. Sign in again to keep going.',
    failed: 'We could not finish signing you in. Try again.',
  },
} satisfies Record<Locale, Record<string, string>>

export const SUGGEST_MESSAGES = {
  es: {
    toolbar: 'Zap en esta página',
    move: 'Mover la barra',
    moveTip: 'Arrastra para mover la barra',
    tools: 'Herramienta',
    navigate: 'Navegar',
    edit: 'Editar',
    comment: 'Comentar',
    editOff: 'Desactivado por un administrador',
    open: (n: number) => plural(n, '{n} abierto', '{n} abiertos'),
    openTitle: 'Comentarios abiertos en esta página',
    noneOpen: 'No hay comentarios abiertos en esta página.',
    changeRequest: 'Solicitud de cambio',
    exit: 'Salir',
    account: (name: string) => `${name}, cuenta`,
    accountMenu: 'Cuenta',
    openInZap: 'Abrir en Zap',
    signOut: 'Cerrar sesión en Zap',
    hide: 'Ocultar barra',
    show: 'Mostrar barra',
    showBar: (n: number) =>
      plural(n, 'Mostrar la barra de Zap, {n} abierto', 'Mostrar la barra de Zap, {n} abiertos'),
    paused: 'Vista previa pausada',
    pausedRunaway: 'La página no dejaba de crecer, así que dejamos de actualizarla.',
    pausedCap: 'La página tiene demasiados campos para seguirlos.',
    reload: 'Recargar',
    newComment: 'Nuevo comentario',
    commentTitle: 'Comentario',
    selected: (n: number) => plural(n, '{n} elemento seleccionado', '{n} elementos seleccionados'),
    clearSelection: 'Cancelar',
    commentLabel: 'Comentario',
    commentPlaceholder: 'Escribe tu comentario',
    requestChange: 'Solicitar cambio',
    requestHelp: 'Queda abierta hasta que alguien la resuelva o aplique el texto propuesto.',
    recipient: 'La recibe la persona responsable en Zap.',
    propose: 'Proponer texto',
    proposalFor: 'Texto propuesto para',
    removeProposal: 'Quitar texto propuesto',
    now: 'Ahora:',
    proposal: 'Texto propuesto',
    cancel: 'Cancelar',
    close: 'Cerrar',
    sending: 'Enviando',
    save: 'Guardar',
    sentComment: 'Comentario enviado',
    sentCommentBody: 'Tu equipo lo verá en Zap.',
    sentRequest: 'Solicitud de cambio enviada',
    sentRequestBody: (name: string | null, proposal: boolean) =>
      `${name ? `${name} la verá` : 'La persona responsable la verá'} en Zap${
        proposal ? ' con tu texto propuesto' : ''
      }. La página no cambia hasta que se publique.`,
    saving: 'Guardando',
    saved: 'Guardado en el borrador',
    editInZap: 'Este campo se edita en Zap',
    /**
     * The field named, what it is, and where it changes («Historia es texto
     * con formato. Cámbialo en el editor de la entrada.»).
     */
    editInZapBody: (label: string, type: string, document: boolean) => {
      const where = `en el editor ${document ? 'del documento' : 'de la entrada'}`
      const kind = (
        {
          IMAGE: ['una imagen', 'Cámbiala'],
          GALLERY: ['una galería', 'Cámbiala'],
          RICH_TEXT: ['texto con formato', 'Cámbialo'],
          VIDEO: ['un video', 'Cámbialo'],
          FILE: ['un archivo', 'Cámbialo'],
        } as Record<string, [string, string]>
      )[type]
      return kind ? `${label} es ${kind[0]}. ${kind[1]} ${where}.` : `${label} se cambia ${where}.`
    },
    enterSaves: 'guarda',
    escCancels: 'cancela',
    yes: 'Sí',
    no: 'No',
    options: (label: string) => `Opciones de ${label}`,
    inRecord: (name: string) => `en ${name}`,
    noFields: 'No hay campos para editar aquí',
    noFieldsBody:
      'Esta página no marca sus campos. Ábrela desde la vista previa de Zap o usa Comentar.',
    editOffBody: 'Un administrador desactivó Editar en este sitio.',
    renewed: 'Sesión renovada',
    renewedAs: (name: string) => `Sigues como ${name}`,
    renewedBody: 'Sigues donde ibas.',
    dismiss: 'Cerrar aviso',
    someone: 'Alguien',
    refusedTitle: 'No puedes editar ni comentar en este sitio',
    refusedBody: 'Tu cuenta no tiene acceso a Zap aquí, o el sitio dejó de permitirlo.',
    rateLimited: (n: number) =>
      plural(
        n,
        'Enviaste muchos seguidos. Intenta de nuevo en {n} segundo.',
        'Enviaste muchos seguidos. Intenta de nuevo en {n} segundos.',
      ),
    failed: 'No se pudo enviar. Revisa el texto e intenta de nuevo.',
    saveFailed: 'No se pudo guardar. El texto volvió a como estaba.',
    noRecord: 'Esta parte de la página no es contenido de Zap.',
    invalidNumber: 'Escribe un número.',
  },
  en: {
    toolbar: 'Zap on this page',
    move: 'Move the bar',
    moveTip: 'Drag to move the bar',
    tools: 'Tool',
    navigate: 'Browse',
    edit: 'Edit',
    comment: 'Comment',
    editOff: 'Turned off by an administrator',
    open: (n: number) => plural(n, '{n} open', '{n} open'),
    openTitle: 'Open comments on this page',
    noneOpen: 'No open comments on this page.',
    changeRequest: 'Change request',
    exit: 'Sign out',
    account: (name: string) => `${name}, account`,
    accountMenu: 'Account',
    openInZap: 'Open in Zap',
    signOut: 'Sign out of Zap',
    hide: 'Hide the bar',
    show: 'Show the bar',
    showBar: (n: number) => plural(n, 'Show the Zap bar, {n} open', 'Show the Zap bar, {n} open'),
    paused: 'Preview paused',
    pausedRunaway: 'The page kept growing, so we stopped updating it.',
    pausedCap: 'The page has too many fields to follow.',
    reload: 'Reload',
    newComment: 'New comment',
    commentTitle: 'Comment',
    selected: (n: number) => plural(n, '{n} element selected', '{n} elements selected'),
    clearSelection: 'Cancel',
    commentLabel: 'Comment',
    commentPlaceholder: 'Write your comment',
    requestChange: 'Request a change',
    requestHelp: 'It stays open until someone resolves it or applies the proposed text.',
    recipient: 'The person responsible in Zap receives it.',
    propose: 'Propose text',
    proposalFor: 'Proposed text for',
    removeProposal: 'Remove proposed text',
    now: 'Now:',
    proposal: 'Proposed text',
    cancel: 'Cancel',
    close: 'Close',
    sending: 'Sending',
    save: 'Save',
    sentComment: 'Comment sent',
    sentCommentBody: 'Your team will see it in Zap.',
    sentRequest: 'Change request sent',
    sentRequestBody: (name: string | null, proposal: boolean) =>
      `${name ?? 'The person responsible'} will see it in Zap${
        proposal ? ' with your proposed text' : ''
      }. The page does not change until it is published.`,
    saving: 'Saving',
    saved: 'Saved to the draft',
    editInZap: 'This field is edited in Zap',
    editInZapBody: (label: string, type: string, document: boolean) => {
      const where = `in the ${document ? "document's" : "entry's"} editor`
      const kind = (
        {
          IMAGE: 'an image',
          GALLERY: 'a gallery',
          RICH_TEXT: 'formatted text',
          VIDEO: 'a video',
          FILE: 'a file',
        } as Record<string, string>
      )[type]
      return kind ? `${label} is ${kind}. Change it ${where}.` : `${label} is changed ${where}.`
    },
    enterSaves: 'saves',
    escCancels: 'cancels',
    yes: 'Yes',
    no: 'No',
    options: (label: string) => `${label} options`,
    inRecord: (name: string) => `in ${name}`,
    noFields: 'Nothing to edit here',
    noFieldsBody:
      'This page does not mark its fields. Open it from the Zap preview or use Comment.',
    editOffBody: 'An administrator turned off Edit for this site.',
    renewed: 'Session renewed',
    renewedAs: (name: string) => `You are still ${name}`,
    renewedBody: 'Pick up where you left off.',
    dismiss: 'Dismiss',
    someone: 'Someone',
    refusedTitle: 'You cannot edit or comment on this site',
    refusedBody: 'Your account has no Zap access here, or the site stopped allowing it.',
    rateLimited: (n: number) =>
      plural(
        n,
        'You sent many in a row. Try again in {n} second.',
        'You sent many in a row. Try again in {n} seconds.',
      ),
    failed: 'Could not send. Check the text and try again.',
    saveFailed: 'Could not save. The text is back to what it was.',
    noRecord: 'This part of the page is not Zap content.',
    invalidNumber: 'Enter a number.',
  },
}

export type SuggestMessages = (typeof SUGGEST_MESSAGES)['es']
export type SigninMessages = (typeof SIGNIN_MESSAGES)['es']
