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
    'Журнал и история остатка сделки не сходятся с самой сделкой',
  wallets_balance_journal_only: 'Баланс меняется только записью в журнал',
  companies_wallet_required: 'У компании должен быть кошелёк',
  wallets_keep_company: 'Кошелёк нельзя удалить или передать другой компании',
  deals_lot_is_published: 'Лот не опубликован',
  deals_unit_price_is_lot_price: 'Цена в сделке не совпадает с ценой лота',
  lot_stock_history_matches_lot: 'Запись истории не совпадает с остатком лота',
  lot_stock_history_chain: 'Запись истории остатка не продолжает предыдущую',
  lots_stock_matches_history: 'Остаток лота не совпадает с историей остатка',
  lots_price_matches_history: 'Цена лота не совпадает с историей цены',
  lots_publication_matches_history:
    'Признак публикации лота не совпадает с историей публикации',
  lot_stock_history_deal_key: 'Движение остатка по этой сделке уже записано',
  lot_stock_history_deal_delta: 'Движение остатка не сходится со сделкой',
  wallets_balance_non_negative: 'Недостаточно средств на кошельке',
  lots_stock_non_negative: 'Недостаточно товара на складе',
};

export const FALLBACK_UNIQUE_MESSAGE = 'Такая запись уже существует';
export const FALLBACK_CHECK_MESSAGE = 'Данные нарушают правила площадки';
