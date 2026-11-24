# ECC Licensing Strategy (Draft)

**Status: planning document only. Not a licence and not a legal offer.**

## 1. Intended model

ECC is planned as a source-available product with a free Community Edition and separately licensed commercial editions.

- Public source code may be inspected.
- Individuals may use and modify the Community Edition for personal, educational and other genuinely non-commercial purposes, subject to the final Community terms.
- Use in business operations, commercial service delivery, paid client deployments, SaaS offerings, resale, sublicensing and commercial redistribution require a separate written commercial licence.
- Enterprise-only modules, hosted services, premium integrations and commercial tooling may be distributed separately under proprietary terms.
- A commercial licence may be annual. Pricing, renewal, territory, permitted deployments, support and any revenue-share terms must be stated in the signed order or agreement.

This is a **source-available** model, not an OSI-approved Open Source licence. A non-commercial restriction is incompatible with the Open Source Definition. Do not describe ECC as "open source" while this model is in force.

## 2. Why the repository remains public

Public visibility supports code review, learning, issue reporting and transparency. It does not itself grant copyright permissions. Until an actual licence is published, no new permission to copy, modify or redistribute the project is granted by this repository.

Do not add a permissive licence such as MIT or Apache-2.0 to the entire repository if the business requirement is to reserve commercial use for separately licensed customers. Those licences generally grant broad commercial permissions that cannot later be withdrawn for already-licensed copies.

## 3. Scope that must be separated

Before the final licence is published, maintain a clear inventory of:

1. ECC-authored source code and documentation.
2. Third-party packages and their individual licences.
3. Generated files, templates, icons, fonts and other assets.
4. Any code or contributions supplied by outside contributors.
5. Future proprietary Enterprise modules.

Third-party components remain subject to their own licences. ECC terms cannot override those licences or claim ownership of third-party code.

## 4. Commercial licence structure

A commercial agreement should identify at least:

- Legal licensor and customer names.
- Product, edition and version covered.
- Permitted legal entities, sites, environments, instances and users.
- Whether production, test, disaster-recovery and development installations are included.
- Permitted internal use and/or client deployments.
- Term, start date, renewal and termination.
- Fees, currency, taxes, payment timing and late-payment rules.
- Support and update entitlement.
- Restrictions on resale, sublicensing, redistribution and providing the software as a service.
- Treatment of customer data and customer-created integrations.
- Confidentiality, warranties, disclaimers and liability limits.
- Governing law, dispute resolution and notices.

If revenue share is used, define the revenue base, exclusions, reporting periods, records, audit notice, audit scope, confidentiality and who pays audit costs. Avoid an unlimited or vague audit right. A fixed annual fee is simpler to administer; a revenue share can be negotiated separately for resellers or OEM partners.

## 5. Copyright and contributor governance

Do not publish a copyright notice naming an individual or company until the legal rightsholder is confirmed. A GitHub username is not automatically the correct legal name of the copyright owner.

Before accepting outside contributions, adopt a Contributor Licence Agreement (CLA) or another reviewed contribution process that clearly grants the rights needed to distribute the Community Edition and commercial editions. Do not silently assume that a pull request transfers copyright.

Keep a record of authorship, dates, commits, third-party notices and signed contribution permissions.

## 6. Publication checklist

The following are blockers before publishing a binding licence:

- Confirm the legal rightsholder and authority to license the code.
- Review applicable law and contract capacity with a qualified lawyer.
- Complete a third-party software and asset licence audit.
- Decide whether Community users may redistribute modified source for non-commercial purposes.
- Decide how plugins, APIs, integrations and hosted deployments are treated.
- Finalize and review the Community licence text.
- Finalize and review the Commercial Licence Agreement and order form.
- Publish contribution rules and the selected CLA/DCO process.
- Add LICENSE, COMMERCIAL-LICENSE.md, COPYRIGHT and THIRD-PARTY-NOTICES only when their contents are accurate and approved.

## 7. Current repository state

This document does not grant a licence. Until the final legal documents are approved and published, the repository's existing no-licence notice remains in effect. Do not advertise the project as Open Source or accept external code contributions under an assumed licence.
