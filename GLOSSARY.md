# Personal Finance

A local dashboard for understanding personal spending, income and debt. It reads bank statements and produces reports to help build financial stability.

## Language

### Sources and outputs

**Statement**:
A bank-issued file in `statements/` holding one account's transactions for a period. It is the single source of truth and is never modified.
_Avoid_: Export, upload, import file

**Transaction**:
One money movement recorded on a statement.
_Avoid_: Entry, line, row

**Report**:
A derived output written to `reports/`, such as transactions with their assigned categories. Reports can be regenerated from statements at any time.
_Avoid_: Export, output file

### Classification

**Taxonomy**:
The editable tree of categories and sub-categories that every transaction is assigned to.
_Avoid_: Tag list, label set

**Category**:
A top-level group in the taxonomy, such as Food & Groceries.
_Avoid_: Type, group, tag

**Sub-category**:
A child of a category, such as Supermarkets under Food & Groceries.
_Avoid_: Subtype, tag

**Payment channel**:
The bank's own transaction-type field (the `categoryOfTransaction` value on a credit card statement, such as contactless or online). It describes how the payment was made, not what it was for.
_Avoid_: Category

### Money flows

**Card repayment**:
A payment from the current account to a credit card. It moves money between the user's own accounts, so it is a transfer and not spending. The matching purchases appear on the credit card statement.
_Avoid_: Expense, bill payment
