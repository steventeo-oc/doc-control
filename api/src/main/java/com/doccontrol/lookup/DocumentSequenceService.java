package com.doccontrol.lookup;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Server-side document number generation (CLAUDE.md convention 1):
 * document_number is always allocated here from document_sequence_counter,
 * never accepted from a client. The counter row is locked for the rest of
 * the allocating transaction, so concurrent creates for the same
 * (type, department) pair get distinct numbers.
 */
@Service
public class DocumentSequenceService {

    private final DocumentSequenceCounterRepository counterRepository;

    public DocumentSequenceService(DocumentSequenceCounterRepository counterRepository) {
        this.counterRepository = counterRepository;
    }

    public record AllocatedNumber(int sequenceNumber, String documentNumber) {
    }

    /**
     * Must run inside the caller's transaction (the same one that inserts the
     * document), so the row lock and the number hand out together.
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public AllocatedNumber allocateNext(DocumentType type, Department department) {
        List<Object[]> rows = counterRepository.lockAndReadNext(type.getId(), department.getId());
        if (rows.isEmpty() || rows.get(0).length < 2) {
            throw new IllegalStateException("Counter allocation returned no row for ("
                    + type.getCode() + ", " + department.getCode() + ")");
        }
        int counterId = ((Number) rows.get(0)[0]).intValue();
        int next = ((Number) rows.get(0)[1]).intValue();

        counterRepository.advance(counterId, next + 1);

        String documentNumber = String.format("%s-%s-%04d", type.getCode(), department.getCode(), next);
        return new AllocatedNumber(next, documentNumber);
    }
}
