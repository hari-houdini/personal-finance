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

### Budget plan

**Mandatory expense**:
A fixed commitment that the plan keeps as it is: rent, council tax, energy, insurance, phone contract, vehicle tax, loan and finance repayments. The slider never changes it.
_Avoid_: Essential (that is the taxonomy's broader kind, which also covers food and transport), fixed bill

**Protected expense**:
A variable expense that is cut last, after discretionary spending: groceries, pharmacy, fuel, pets and family support.
_Avoid_: Essential, must-have

**Variable expense**:
Any spending that is neither mandatory nor protected. The slider shares out what is left across these, in proportion to what you usually spend.
_Avoid_: Discretionary (that is the taxonomy kind, which is narrower)

**Base salary**:
The regular pay used for planning, without bonuses. It changes once a year, at the October pay rise.
_Avoid_: Income, wage

**Bonus**:
A payment above base salary. The plan leaves it out of income, so it never funds regular spending.
_Avoid_: Extra pay, one-off income

**Household contribution**:
Money another person in the household sends you on a regular basis. The plan counts it as income.
_Avoid_: Transfer in, gift

**Saving**:
The amount you set aside each month, chosen with the slider. Spending allowances are what remains after mandatory costs and saving.
_Avoid_: Savings rate (that is a share of income)

**Spending allowance**:
The most you can spend in one variable category in a month, at the saving you chose.
_Avoid_: Budget, limit

**Stability target**:
The emergency-fund size and savings rate the plan aims for: a floor of 3 months of mandatory spend, 6 months in full, and 20% of income saved.
_Avoid_: Goal, threshold
