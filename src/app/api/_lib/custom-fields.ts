/** Serialización de CustomField al shape que consume el frontend (fieldType/isActive). */
export function serializeField(field: {
  id: string
  entity: string
  name: string
  label: string
  type: string
  options: string | null
  isRequired: boolean
  order: number
  createdAt: Date
}) {
  return {
    id: field.id,
    name: field.name,
    label: field.label,
    fieldType: field.type,
    type: field.type,
    entity: field.entity,
    options: field.options,
    isRequired: field.isRequired,
    order: field.order,
    isActive: true,
    createdAt: field.createdAt,
  }
}
