package com.doccontrol.lookup;

/** API shape of a document tier. */
public record DocumentTierDto(Integer id, Integer tierNumber, String label, boolean active) {

    public static DocumentTierDto from(DocumentTier tier) {
        return new DocumentTierDto(tier.getId(), tier.getTierNumber(), tier.getLabel(), tier.isActive());
    }
}
