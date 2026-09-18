package com.doccontrol.document;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface UserDocumentFavoriteRepository extends JpaRepository<UserDocumentFavorite, Integer> {

    boolean existsByUserIdAndDocumentId(Integer userId, Integer documentId);

    Optional<UserDocumentFavorite> findByUserIdAndDocumentId(Integer userId, Integer documentId);

    void deleteByUserIdAndDocumentId(Integer userId, Integer documentId);

    @Query("SELECT f.document.id FROM UserDocumentFavorite f WHERE f.user.id = :userId")
    List<Integer> findDocumentIdsByUserId(@Param("userId") Integer userId);
}
