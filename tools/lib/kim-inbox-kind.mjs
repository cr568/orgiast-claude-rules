/**
 * 本文が承認・判断を求めているか判定する
 *
 * @param {string} text - 受信箱項目の本文
 * @returns {boolean}
 */
export function looksLikeApprovalRequest(text) {
  return /承認|判断|どちら|YES|決めて/.test(text ?? "");
}
