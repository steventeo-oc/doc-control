package com.doccontrol.workflow;

import com.doccontrol.audit.NotificationLog;
import com.doccontrol.audit.NotificationLogRepository;
import com.doccontrol.config.AppProperties;
import com.doccontrol.document.Document;
import com.doccontrol.document.DocumentVersion;
import com.doccontrol.identity.User;
import com.doccontrol.identity.UserRepository;
import com.doccontrol.lookup.Department;
import com.doccontrol.notification.NotificationSender;
import com.doccontrol.notification.NotificationTemplateService;
import org.flowable.engine.TaskService;
import org.flowable.task.api.Task;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Date;
import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class WorkflowNotificationServiceTests {

    @Mock
    NotificationSender notificationSender;

    @Mock
    NotificationLogRepository notificationLogRepository;

    @Mock
    UserRepository userRepository;

    @Mock
    TaskService taskService;

    WorkflowNotificationService service;
    NotificationTemplateService templateService = new NotificationTemplateService();
    AppProperties appProperties = new AppProperties("http://localhost:3000");

    User owner;
    User reviewer1;
    User reviewer2;
    Department dept;
    Document doc;
    DocumentVersion version;
    WorkflowInstance instance;

    @BeforeEach
    void setUp() {
        service = new WorkflowNotificationService(
                notificationSender,
                templateService,
                notificationLogRepository,
                userRepository,
                appProperties,
                taskService
        );

        lenient().doReturn("log").when(notificationSender).channel();

        dept = new Department();
        dept.setId(1);
        dept.setCode("QA");
        dept.setLabel("Quality Assurance");

        owner = new User();
        owner.setId(10);
        owner.setName("Document Owner");
        owner.setEmail("owner@example.com");
        owner.setActive(true);

        reviewer1 = new User();
        reviewer1.setId(20);
        reviewer1.setName("Reviewer Alice");
        reviewer1.setEmail("alice@example.com");
        reviewer1.setActive(true);

        reviewer2 = new User();
        reviewer2.setId(21);
        reviewer2.setName("Reviewer Bob");
        reviewer2.setEmail("bob@example.com");
        reviewer2.setActive(true);

        doc = new Document();
        doc.setId(100);
        doc.setDocumentNumber("SOP-QA-001");
        doc.setName("Equipment Calibration");
        doc.setDepartment(dept);
        doc.setOwner(owner);

        version = new DocumentVersion();
        version.setId(200);
        version.setDocument(doc);
        version.setVersionNumber(1);

        instance = new WorkflowInstance();
        instance.setId(300);
        instance.setDocumentVersion(version);
        instance.setKind(WorkflowInstanceKind.APPROVAL);
        instance.setStartedBy(owner);
    }

    @Test
    void notifyReviewersOfNewTaskSendsEmailAndLogsRow() {
        Task task1 = mock(Task.class);
        when(task1.getId()).thenReturn("task-1");
        when(task1.getAssignee()).thenReturn("20");
        when(task1.getDueDate()).thenReturn(Date.from(Instant.parse("2026-09-25T09:00:00Z")));

        when(userRepository.findById(20)).thenReturn(Optional.of(reviewer1));
        when(notificationLogRepository.existsByKindAndFlowableTaskIdAndRecipientId("TASK_ASSIGNED", "task-1", 20))
                .thenReturn(false);

        service.notifyReviewersOfNewTask(instance, List.of(task1), doc, version, owner);

        verify(notificationSender).sendHtml(
                eq(reviewer1),
                eq("Action Required: Approval for SOP-QA-001 Rev 1"),
                any(),
                any()
        );

        ArgumentCaptor<NotificationLog> logCaptor = ArgumentCaptor.forClass(NotificationLog.class);
        verify(notificationLogRepository).save(logCaptor.capture());
        NotificationLog saved = logCaptor.getValue();
        assertThat(saved.getKind()).isEqualTo("TASK_ASSIGNED");
        assertThat(saved.getFlowableTaskId()).isEqualTo("task-1");
        assertThat(saved.getRecipient()).isEqualTo(reviewer1);
        assertThat(saved.getDocument()).isEqualTo(doc);
        assertThat(saved.getDocumentVersion()).isEqualTo(version);
    }

    @Test
    void notifyReviewersOfNewTaskSkipsAlreadyNotified() {
        Task task1 = mock(Task.class);
        when(task1.getId()).thenReturn("task-1");
        when(task1.getAssignee()).thenReturn("20");
        when(userRepository.findById(20)).thenReturn(Optional.of(reviewer1));
        when(notificationLogRepository.existsByKindAndFlowableTaskIdAndRecipientId("TASK_ASSIGNED", "task-1", 20))
                .thenReturn(true);

        service.notifyReviewersOfNewTask(instance, List.of(task1), doc, version, owner);

        verify(notificationSender, never()).sendHtml(any(), any(), any(), any());
        verify(notificationLogRepository, never()).save(any());
    }

    @Test
    void notifyOwnerAndStarterOfApprovalDeduplicatesRecipients() {
        // Owner and starter are both 'owner' (ID 10)
        service.notifyOwnerAndStarterOfApproval(instance, doc, version, LocalDate.now(), false, reviewer1);

        verify(notificationSender, times(1)).sendHtml(
                eq(owner),
                eq("Approved: SOP-QA-001 Rev 1 - Equipment Calibration"),
                any(),
                any()
        );

        ArgumentCaptor<NotificationLog> logCaptor = ArgumentCaptor.forClass(NotificationLog.class);
        verify(notificationLogRepository, times(1)).save(logCaptor.capture());
        assertThat(logCaptor.getValue().getKind()).isEqualTo("APPROVAL_COMPLETED");
    }

    @Test
    void notifyOwnerAndStarterOfRejectionIncludesComment() {
        User starter = new User();
        starter.setId(11);
        starter.setName("Draft Submitter");
        starter.setEmail("submitter@example.com");
        starter.setActive(true);
        instance.setStartedBy(starter);

        service.notifyOwnerAndStarterOfRejection(instance, doc, version, reviewer1, "Section 3 needs revision");

        // Both owner and starter notified
        verify(notificationSender).sendHtml(
                eq(owner),
                eq("Changes Requested / Rejected: SOP-QA-001 Rev 1 - Equipment Calibration"),
                any(),
                any()
        );
        verify(notificationSender).sendHtml(
                eq(starter),
                eq("Changes Requested / Rejected: SOP-QA-001 Rev 1 - Equipment Calibration"),
                any(),
                any()
        );

        verify(notificationLogRepository, times(2)).save(any(NotificationLog.class));
    }

    @Test
    void notifyReviewersOfCancellationNotifiesActiveTaskAssignees() {
        Task task1 = mock(Task.class);
        when(task1.getAssignee()).thenReturn("20");
        when(userRepository.findById(20)).thenReturn(Optional.of(reviewer1));

        Task task2 = mock(Task.class);
        when(task2.getAssignee()).thenReturn("21");
        when(userRepository.findById(21)).thenReturn(Optional.of(reviewer2));

        service.notifyReviewersOfCancellation(instance, doc, version, owner, List.of(task1, task2));

        verify(notificationSender).sendHtml(
                eq(reviewer1),
                eq("Workflow Cancelled: SOP-QA-001 Rev 1 - Equipment Calibration"),
                any(),
                any()
        );
        verify(notificationSender).sendHtml(
                eq(reviewer2),
                eq("Workflow Cancelled: SOP-QA-001 Rev 1 - Equipment Calibration"),
                any(),
                any()
        );

        verify(notificationLogRepository, times(2)).save(any(NotificationLog.class));
    }

    @Test
    void sendFailuresNeverThrowExceptions() {
        Task task1 = mock(Task.class);
        when(task1.getId()).thenReturn("task-err");
        when(task1.getAssignee()).thenReturn("20");
        when(userRepository.findById(20)).thenReturn(Optional.of(reviewer1));
        when(notificationLogRepository.existsByKindAndFlowableTaskIdAndRecipientId("TASK_ASSIGNED", "task-err", 20))
                .thenReturn(false);

        doThrow(new IllegalStateException("Graph connection timeout"))
                .when(notificationSender).sendHtml(any(), any(), any(), any());

        assertThatCode(() -> service.notifyReviewersOfNewTask(instance, List.of(task1), doc, version, owner))
                .doesNotThrowAnyException();
    }
}
