/** Client-facing text for a violated database constraint (names come from the migration). */
export const CONSTRAINT_MESSAGES: Record<string, string> = {
  companies_email_lower_key: 'Компания с таким email уже зарегистрирована',
  wallets_company_id_key: 'У компании уже есть кошелёк',
  wallet_operations_bank_notification_key:
    'Это банковское уведомление уже обработано',
  wallet_operations_deal_wallet_key: 'Операция по этой сделке уже записана',
  lot_price_history_lot_id_valid_from_key:
    'Цена лота на этот момент уже записана',
  lot_delivery_methods_pkey: 'Способ доставки указан дважды',
  lot_photos_s3_key_key: 'Файл с таким ключом уже привязан к лоту',
  lot_photos_lot_id_position_key: 'Это место в галерее лота уже занято',
  wallet_operations_deal_ledger:
    'Журнал сделки не сходится с её суммой и участниками',
  wallets_balance_non_negative: 'Недостаточно средств на кошельке',
  lots_stock_non_negative: 'Недостаточно товара на складе',
};

export const FALLBACK_UNIQUE_MESSAGE = 'Такая запись уже существует';
export const FALLBACK_CHECK_MESSAGE = 'Данные нарушают правила площадки';
